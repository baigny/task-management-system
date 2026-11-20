import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
/** Select the fixture account used for an authenticated project request. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });

describe('project creation', () => {
  beforeAll(async () => { users = await accounts(2); });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('requires authentication and creates the owner membership atomically', async () => {
    await request(app).post('/api/v1/projects').send({ name: 'Release' }).expect(401);
    const result = await request(app).post('/api/v1/projects').set(auth()).send({ name: ' Release ', description: 'Ship the release' }).expect(201);
    expect(result.body).toMatchObject({ name: 'Release', description: 'Ship the release', ownerId: users[0].id });
    expect(await db.membership.count({ where: { projectId: result.body.id, userId: users[0].id } })).toBe(1);
    expect(await db.membership.count({ where: { projectId: result.body.id, userId: users[1].id } })).toBe(0);
  });
  it('defaults descriptions and permits owning multiple projects', async () => {
    const result = await request(app).post('/api/v1/projects').set(auth()).send({ name: 'Second project' }).expect(201);
    expect(result.body.description).toBe('');
    expect(await db.project.count({ where: { ownerId: users[0].id } })).toBe(2);
  });
  it('rejects empty names, oversized descriptions, and supplied ownership', async () => {
    for (const input of [{ name: ' ' }, { name: 'x'.repeat(101) }, { name: 'Release', description: 'x'.repeat(5001) }, { name: 'Release', ownerId: users[1].id }]) {
      await request(app).post('/api/v1/projects').set(auth()).send(input).expect(400);
    }
    expect(await db.project.count({ where: { ownerId: users[0].id } })).toBe(2);
  });
});
