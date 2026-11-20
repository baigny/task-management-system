import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
/** Select the fixture account for a lifecycle request. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Build a request path for this suite's project. */
const path = (suffix = '') => `/api/v1/projects/${projectId}${suffix}`;

describe('project deletion and history', () => {
  beforeAll(async () => {
    users = await accounts(3);
    const created = await request(app).post('/api/v1/projects').set(auth()).send({ name: 'Lifecycle' }).expect(201);
    projectId = created.body.id;
    await db.membership.create({ data: { projectId, userId: users[1].id } });
  });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('requires the owner for deletion and prior soft deletion for purge', async () => {
    await request(app).delete(path()).expect(401);
    await request(app).delete(path()).set(auth(2)).expect(404);
    await request(app).delete(path()).set(auth(1)).expect(403);
    await request(app).delete(path('/permanent')).set(auth()).expect(409);
    await request(app).post(path('/restore')).set(auth()).expect(409);
  });
  it('records changes atomically and protects activity from outsiders', async () => {
    await request(app).patch(path()).set(auth()).send({ name: 'New name' }).expect(200);
    const result = await request(app).get(path('/activity?limit=1')).set(auth(1)).expect(200);
    expect(result.body).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(result.body.items[0]).toMatchObject({ action: 'PROJECT_UPDATED', actorId: users[0].id, metadata: { fields: ['name'] } });
    await request(app).get(path('/activity')).set(auth(2)).expect(404);
  });
  it('hides deleted projects while preserving memberships and deletion metadata', async () => {
    await request(app).delete(path()).set(auth()).expect(204);
    const saved = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(saved.deletedAt).toBeInstanceOf(Date);
    expect(saved.deletedById).toBe(users[0].id);
    expect(await db.membership.count({ where: { projectId } })).toBe(2);
    for (const index of [0, 1]) {
      await request(app).get(path()).set(auth(index)).expect(404);
      expect((await request(app).get('/api/v1/projects').set(auth(index)).expect(200)).body.items).toEqual([]);
    }
    await request(app).patch(path()).set(auth()).send({ name: 'Hidden' }).expect(404);
    await request(app).get(path('/activity')).set(auth(1)).expect(404);
    const history = await request(app).get(path('/activity')).set(auth()).expect(200);
    expect(history.body.items[0].action).toBe('PROJECT_DELETED');
    const trash = await request(app).get('/api/v1/projects?deleted=true').set(auth()).expect(200);
    expect(trash.body.items[0].id).toBe(projectId);
    expect((await request(app).get('/api/v1/projects?deleted=true').set(auth(1)).expect(200)).body.items).toEqual([]);
    await request(app).get('/api/v1/projects?deleted=invalid').set(auth()).expect(400);
  });
  it('allows only one concurrent restore and retains the original memberships', async () => {
    await request(app).post(path('/restore')).set(auth(1)).expect(403);
    await request(app).post(path('/restore')).set(auth(2)).expect(404);
    const results = await Promise.all([request(app).post(path('/restore')).set(auth()), request(app).post(path('/restore')).set(auth())]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    const restored = await request(app).get(path()).set(auth(1)).expect(200);
    expect(restored.body).toMatchObject({ deletedAt: null, deletedById: null });
    expect(await db.activity.count({ where: { projectId, action: 'PROJECT_RESTORED' } })).toBe(1);
  });
  it('purges project children only after deletion and only for the owner', async () => {
    await request(app).delete(path()).set(auth()).expect(204);
    await request(app).delete(path('/permanent')).set(auth(1)).expect(403);
    await request(app).delete(path('/permanent')).set(auth(2)).expect(404);
    await request(app).delete(path('/permanent')).set(auth()).expect(204);
    expect(await db.project.count({ where: { id: projectId } })).toBe(0);
    expect(await db.membership.count({ where: { projectId } })).toBe(0);
    expect(await db.activity.count({ where: { projectId } })).toBe(0);
    await request(app).post(path('/restore')).set(auth()).expect(404);
  });
});
