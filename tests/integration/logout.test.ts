import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { createSession } from '../../src/auth/service.js';

let userId: string;
let token: string;
let otherToken: string;
describe('device logout', () => {
  beforeAll(async () => {
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Logout test', passwordHash: 'fixture-not-used-for-login' } });
    userId = user.id;
    token = (await createSession(user)).token;
    otherToken = (await createSession(user)).token;
  });
  afterAll(async () => { await db.user.delete({ where: { id: userId } }); await db.$disconnect(); });
  it('requires authentication for both logout modes', async () => {
    await request(app).post('/api/v1/auth/logout').expect(401);
    await request(app).post('/api/v1/auth/logout-all').expect(401);
  });
  it('revokes one device immediately and preserves the other', async () => {
    const result = await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);
    expect(result.text).toBe('');
    expect(result.headers['cache-control']).toBe('no-store');
    await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${otherToken}`).expect(200);
  });
  it('revokes every device including the requesting one', async () => {
    const extra = await createSession({ id: userId });
    await request(app).post('/api/v1/auth/logout-all').set('Authorization', `Bearer ${otherToken}`).expect(204);
    await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${otherToken}`).expect(401);
    await request(app).get('/api/v1/users/me').set('Authorization', `Bearer ${extra.token}`).expect(401);
    expect(await db.session.count({ where: { userId } })).toBe(0);
  });
  it('allows logout even after exhausting the login IP limit', async () => {
    for (let index = 0; index < 30; index++) await request(app).post('/api/v1/auth/login').send({});
    await request(app).post('/api/v1/auth/login').send({}).expect(429);
    const session = await createSession({ id: userId });
    await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${session.token}`).expect(204);
  });
});
