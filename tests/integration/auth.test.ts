import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import express from 'express';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { config } from '../../src/config.js';
import { createSession } from '../../src/auth/service.js';
import { accountKey } from '../../src/auth/throttle.js';
import { authenticate } from '../../src/auth/middleware.js';
import { errorHandler } from '../../src/errors.js';

const email = `auth-${randomUUID()}@example.com`;
const unknownEmail = `unknown-${randomUUID()}@example.com`;
let token = '';
let userId = '';
/** Build a bearer header for the current test session. */
const auth = (value = token) => ({ Authorization: `Bearer ${value}` });
const protectedResource = express();
protectedResource.get('/protected', authenticate, (_req, res) => { res.json({ status: 'ok' }); });
protectedResource.use(errorHandler);

describe('registration, login and token verification', () => {
  beforeAll(async () => { await db.$connect(); });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.authAttempt.deleteMany({ where: { key: { in: [accountKey('login', email), accountKey('login', unknownEmail)] } } });
    await db.$disconnect();
  });
  it('registers with confirmation, explicit Argon2id hashing and no private response fields', async () => {
    const input = { email, name: 'Developer', password: 'strong-password-123', confirmPassword: 'strong-password-123' };
    await request(app).post('/api/v1/auth/register').send({ ...input, confirmPassword: 'not-the-same-password' }).expect(400);
    const result = await request(app).post('/api/v1/auth/register').send(input).expect(201);
    token = result.body.token; userId = result.body.user.id;
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.user.passwordHash).toBeUndefined();
    expect(result.body.user.confirmPassword).toBeUndefined();
    const stored = await db.user.findUniqueOrThrow({ where: { email } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
    await request(app).post('/api/v1/auth/register').send(input).expect(409);
  });
  it('returns the same invalid-credential response for unknown accounts and wrong passwords', async () => {
    const bad = await request(app).post('/api/v1/auth/login').send({ email, password: 'incorrect' }).expect(401);
    const missing = await request(app).post('/api/v1/auth/login').send({ email: unknownEmail, password: 'incorrect' }).expect(401);
    expect(missing.body).toEqual(bad.body);
    const result = await request(app).post('/api/v1/auth/login').send({ email: email.toUpperCase(), password: 'strong-password-123' }).expect(200);
    expect(result.body.token).not.toBe(token);
    expect(await db.authAttempt.findUnique({ where: { key: accountKey('login', email) } })).toBeNull();
  });
  it('rejects missing, invalid, expired and database-expired sessions', async () => {
    await request(protectedResource).get('/protected').set(auth()).expect(200);
    await request(protectedResource).get('/protected').expect(401);
    await request(protectedResource).get('/protected').set(auth('invalid')).expect(401);
    const expired = jwt.sign({ sub: userId, sid: randomUUID() }, config.JWT_SECRET, { expiresIn: -1, issuer: 'task-management', audience: 'task-api' });
    await request(protectedResource).get('/protected').set(auth(expired)).expect(401);
    const session = await createSession({ id: userId });
    const claims = jwt.decode(session.token) as { sid: string };
    await db.session.update({ where: { id: claims.sid }, data: { expiresAt: new Date(0) } });
    await request(protectedResource).get('/protected').set(auth(session.token)).expect(401);
  });
  it('enforces and expires temporary account cooldowns', async () => {
    for (let index = 0; index < 5; index++) await request(app).post('/api/v1/auth/login').send({ email, password: 'incorrect' }).expect(401);
    const blocked = await request(app).post('/api/v1/auth/login').send({ email, password: 'strong-password-123' }).expect(429);
    expect(blocked.headers['retry-after']).toBe('900');
    await db.authAttempt.update({ where: { key: accountKey('login', email) }, data: { windowStartedAt: new Date(0) } });
    await request(app).post('/api/v1/auth/login').send({ email, password: 'strong-password-123' }).expect(200);
  });
  it('limits authentication by IP', async () => {
    let blocked = false;
    for (let index = 0; index < 31; index++) {
      const response = await request(app).post('/api/v1/auth/login').send({});
      if (response.status === 429) { blocked = true; break; }
    }
    expect(blocked).toBe(true);
  });
});
