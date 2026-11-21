import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
/** Authenticate a request as a fixture account. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Create a project with owner and member fixtures. */
async function project(memberIndexes = [1]) {
  return db.project.create({ data: { name: 'Roles', ownerId: users[0].id, memberships: { create: [0, ...memberIndexes].map(index => ({ userId: users[index].id })) } } });
}

describe('project members and ownership', () => {
  beforeAll(async () => { users = await accounts(3); });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('lists public profiles and enforces membership on every project', async () => {
    const team = await project();
    const result = await request(app).get(`/api/v1/projects/${team.id}/members?limit=1`).set(auth(1)).expect(200);
    expect(result.body).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(result.body.items).toHaveLength(1);
    expect(Object.keys(result.body.items[0].user).sort()).toEqual(['createdAt', 'email', 'id', 'name']);
    await request(app).get(`/api/v1/projects/${team.id}/members`).set(auth(2)).expect(404);
    await request(app).get(`/api/v1/projects/${team.id}/members?limit=101`).set(auth()).expect(400);
  });
  it('transfers ownership within one project and keeps the previous owner as a member', async () => {
    const first = await project();
    const second = await project();
    const transferred = await request(app).post(`/api/v1/projects/${first.id}/ownership`).set(auth()).send({ newOwnerId: users[1].id }).expect(200);
    expect(transferred.body.ownerId).toBe(users[1].id);
    const roles = (await request(app).get(`/api/v1/projects/${first.id}/members`).set(auth()).expect(200)).body.items;
    expect(roles.find((member: { userId: string }) => member.userId === users[0].id).role).toBe('MEMBER');
    expect(roles.find((member: { userId: string }) => member.userId === users[1].id).role).toBe('OWNER');
    expect((await db.project.findUniqueOrThrow({ where: { id: second.id } })).ownerId).toBe(users[0].id);
    await request(app).patch(`/api/v1/projects/${first.id}`).set(auth()).send({ name: 'No longer owner' }).expect(403);
    await request(app).patch(`/api/v1/projects/${first.id}`).set(auth(1)).send({ name: 'New owner' }).expect(200);
    expect(await db.activity.count({ where: { projectId: first.id, action: 'OWNERSHIP_TRANSFERRED' } })).toBe(1);
  });
  it('rejects nonowners, outsiders, and invalid nominations', async () => {
    const team = await project();
    const route = `/api/v1/projects/${team.id}/ownership`;
    await request(app).post(route).set(auth(1)).send({ newOwnerId: users[1].id }).expect(403);
    await request(app).post(route).set(auth(2)).send({ newOwnerId: users[2].id }).expect(404);
    await request(app).post(route).set(auth()).send({ newOwnerId: users[2].id }).expect(400);
    await request(app).post(route).set(auth()).send({ newOwnerId: users[0].id }).expect(409);
    await request(app).post(route).set(auth()).send({ newOwnerId: 'invalid' }).expect(400);
  });
  it('serializes competing transfers and blocks ownership changes on deleted projects', async () => {
    const team = await project([1, 2]);
    const results = await Promise.all([1, 2].map(index => request(app).post(`/api/v1/projects/${team.id}/ownership`).set(auth()).send({ newOwnerId: users[index].id })));
    expect(results.map(result => result.status).sort()).toEqual([200, 403]);
    expect(await db.activity.count({ where: { projectId: team.id, action: 'OWNERSHIP_TRANSFERRED' } })).toBe(1);
    const deleted = await project();
    await request(app).delete(`/api/v1/projects/${deleted.id}`).set(auth()).expect(204);
    await request(app).post(`/api/v1/projects/${deleted.id}/ownership`).set(auth()).send({ newOwnerId: users[1].id }).expect(404);
    await request(app).get(`/api/v1/projects/${deleted.id}/members`).set(auth(1)).expect(404);
  });
});
