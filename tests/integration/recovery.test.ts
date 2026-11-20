import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { config } from '../../src/config.js';
import { createSession, hashPassword } from '../../src/auth/service.js';
import { drainRecoveryJobs, resetTokenHash } from '../../src/auth/recovery.js';
import { accountKey } from '../../src/auth/throttle.js';

const sendEmail = vi.hoisted(() => vi.fn<(email: string, token: string) => Promise<void>>());
vi.mock('../../src/auth/mail.js', () => ({ sendResetEmail: sendEmail }));
const email = `${randomUUID()}@example.com`;
const unknown = `${randomUUID()}@example.com`;
const cooldownEmail = `${randomUUID()}@example.com`;
const deliveries: { email: string; token: string }[] = [];
let userId: string;
let originalToken: string;
let resetToken: string;
let tokenAfterReset: string;
const newPasswords = { password: 'replacement-password-123', confirmPassword: 'replacement-password-123' };

/** Create independent recovery tokens for expiry and invalidation scenarios. */
async function createReset(expiresAt = new Date(Date.now() + 900000)) {
  const token = randomBytes(32).toString('hex');
  await db.passwordReset.create({ data: { userId, tokenHash: resetTokenHash(token), expiresAt } });
  return token;
}

describe('password recovery and changes', () => {
  beforeAll(async () => {
    sendEmail.mockImplementation(async (address, token) => { deliveries.push({ email: address, token }); });
    const user = await db.user.create({ data: { email, name: 'Recovery test', passwordHash: await hashPassword('original-password-123') } });
    userId = user.id;
    originalToken = (await createSession(user)).token;
    await createSession(user);
  });
  afterAll(async () => {
    await drainRecoveryJobs();
    await db.user.delete({ where: { id: userId } });
    await db.authAttempt.deleteMany({ where: { key: { in: [email, unknown, cooldownEmail].flatMap(address => ['forgot-password', 'login', 'change-password'].map(scope => accountKey(scope, address))) } } });
    await db.$disconnect();
  });
  it('responds identically for known and unknown accounts and persists only a token digest', async () => {
    const known = await request(app).post('/api/v1/auth/forgot-password').send({ email }).expect(202);
    const missing = await request(app).post('/api/v1/auth/forgot-password').send({ email: unknown }).expect(202);
    expect(missing.body).toEqual(known.body);
    expect(known.headers['cache-control']).toBe('no-store');
    expect(known.body.token).toBeUndefined();
    await drainRecoveryJobs();
    expect(deliveries).toHaveLength(1);
    resetToken = deliveries[0].token;
    const stored = await db.passwordReset.findUniqueOrThrow({ where: { tokenHash: resetTokenHash(resetToken) } });
    expect(stored.tokenHash).not.toBe(resetToken);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeGreaterThan(890000);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeLessThanOrEqual(900100);
  });
  it('rejects mismatched confirmation without consuming a valid token', async () => {
    await request(app).post('/api/v1/auth/reset-password').send({ ...newPasswords, token: resetToken, confirmPassword: 'different-password' }).expect(400);
    expect(await db.passwordReset.findUnique({ where: { tokenHash: resetTokenHash(resetToken) } })).not.toBeNull();
  });
  it('rejects expired and unknown tokens with the same response', async () => {
    const expired = await createReset(new Date(0));
    const first = await request(app).post('/api/v1/auth/reset-password').send({ ...newPasswords, token: expired }).expect(400);
    const second = await request(app).post('/api/v1/auth/reset-password').send({ ...newPasswords, token: randomBytes(32).toString('hex') }).expect(400);
    expect(second.body).toEqual(first.body);
  });
  it('allows only one concurrent reset and revokes sessions plus every outstanding token', async () => {
    await createReset();
    const attempts = await Promise.all([1, 2].map(() => request(app).post('/api/v1/auth/reset-password').send({ ...newPasswords, token: resetToken })));
    expect(attempts.map(response => response.status).sort()).toEqual([204, 400]);
    await request(app).post('/api/v1/auth/reset-password').send({ ...newPasswords, token: resetToken }).expect(400);
    expect(await db.passwordReset.count({ where: { userId } })).toBe(0);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${originalToken}`).expect(401);
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await argon2.verify(stored.passwordHash, newPasswords.password)).toBe(true);
  });
  it('requires fresh login and current-password verification for authenticated changes', async () => {
    await request(app).post('/api/v1/auth/login').send({ email, password: 'original-password-123' }).expect(401);
    const login = await request(app).post('/api/v1/auth/login').send({ email, password: newPasswords.password }).expect(200);
    tokenAfterReset = login.body.token;
    const body = { currentPassword: 'incorrect', password: 'changed-password-456', confirmPassword: 'changed-password-456' };
    await request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${tokenAfterReset}`).send(body).expect(401);
    await request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${tokenAfterReset}`).send({ ...body, currentPassword: newPasswords.password, confirmPassword: 'different-password' }).expect(400);
    await createSession({ id: userId });
    await createReset();
    await request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${tokenAfterReset}`).send({ ...body, currentPassword: newPasswords.password }).expect(204);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    expect(await db.passwordReset.count({ where: { userId } })).toBe(0);
    await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${tokenAfterReset}`).expect(401);
    expect(await argon2.verify((await db.user.findUniqueOrThrow({ where: { id: userId } })).passwordHash, body.password)).toBe(true);
  });
  it('keeps SMTP failure private and deletes the undelivered token', async () => {
    sendEmail.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await request(app).post('/api/v1/auth/forgot-password').send({ email }).expect(202);
    await drainRecoveryJobs();
    expect(await db.passwordReset.count({ where: { userId } })).toBe(0);
  });
  it('applies the same temporary per-account cooldown to unknown emails', async () => {
    for (let index = 0; index < 5; index++) await request(app).post('/api/v1/auth/forgot-password').send({ email: cooldownEmail }).expect(202);
    await request(app).post('/api/v1/auth/forgot-password').send({ email: cooldownEmail }).expect(429);
    await db.authAttempt.update({ where: { key: accountKey('forgot-password', cooldownEmail) }, data: { windowStartedAt: new Date(0) } });
    await request(app).post('/api/v1/auth/forgot-password').send({ email: cooldownEmail }).expect(202);
  });
  it('returns a uniform unavailable response when SMTP is not configured', async () => {
    const previous = config.SMTP_HOST;
    try {
      config.SMTP_HOST = '';
      await request(app).post('/api/v1/auth/forgot-password').send({ email }).expect(503);
    } finally { config.SMTP_HOST = previous; }
  });
});
