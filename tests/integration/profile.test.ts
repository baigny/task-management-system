import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { createSession } from '../../src/auth/service.js';

let userId: string;
let token: string;
describe('profile management', () => {
  beforeAll(async () => {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Original', passwordHash: 'fixture-not-used-for-login' } });
    userId = user.id;
    token = (await createSession(user)).token;
  });
  afterAll(async () => { await db.user.delete({ where: { id: userId } }); await db.$disconnect(); });
  it('requires authentication and returns only public fields', async () => {
    await request(app).get('/api/v1/users/me').expect(401);
    const result = await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(Object.keys(result.body).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
    expect(result.body.id).toBe(userId);
    expect(result.headers['cache-control']).toBe('no-store');
  });
  it('persists a normalized display name', async () => {
    const result = await request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${token}`).send({ name: ' Updated ' }).expect(200);
    expect(result.body.name).toBe('Updated');
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).name).toBe('Updated');
  });
  it('rejects empty names and protected fields without changing account data', async () => {
    for (const body of [{ name: '' }, { email: 'override@example.com' }, { passwordHash: 'override' }, { name: 'Changed', role: 'admin' }]) {
      await request(app).patch('/api/v1/users/me').set('Authorization', `Bearer ${token}`).send(body).expect(400);
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).name).toBe('Updated');
  });
});
