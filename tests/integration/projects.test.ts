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
  it('isolates project reads and allows membership in multiple projects', async () => {
    const owned = await db.project.findMany({ where: { ownerId: users[0].id }, orderBy: { createdAt: 'asc' } });
    await request(app).get(`/api/v1/projects/${owned[0].id}`).set(auth(1)).expect(404);
    expect((await request(app).get('/api/v1/projects').set(auth(1)).expect(200)).body.total).toBe(0);
    await db.membership.createMany({ data: owned.map(project => ({ projectId: project.id, userId: users[1].id })) });
    await request(app).get(`/api/v1/projects/${owned[0].id}`).set(auth(1)).expect(200);
    const page = await request(app).get('/api/v1/projects?limit=1').set(auth(1)).expect(200);
    expect(page.body).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(page.body.items).toHaveLength(1);
    const next = await request(app).get('/api/v1/projects?limit=1&page=2').set(auth(1)).expect(200);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
    expect((await request(app).get('/api/v1/projects?page=3&limit=1').set(auth()).expect(200)).body.items).toEqual([]);
  });
  it('validates read identifiers, pagination, and authentication', async () => {
    await request(app).get('/api/v1/projects').expect(401);
    await request(app).get('/api/v1/projects/invalid').set(auth()).expect(400);
    await request(app).get('/api/v1/projects?limit=101').set(auth()).expect(400);
    await request(app).get('/api/v1/projects?page=0').set(auth()).expect(400);
  });
  it('allows only owners to update details and preserves omitted fields', async () => {
    const project = await db.project.findFirstOrThrow({ where: { ownerId: users[0].id, description: 'Ship the release' } });
    await request(app).patch(`/api/v1/projects/${project.id}`).send({ name: 'No auth' }).expect(401);
    await request(app).patch(`/api/v1/projects/${project.id}`).set(auth(1)).send({ name: 'Forbidden' }).expect(403);
    const updated = await request(app).patch(`/api/v1/projects/${project.id}`).set(auth()).send({ name: ' Updated ' }).expect(200);
    expect(updated.body).toMatchObject({ name: 'Updated', description: 'Ship the release', ownerId: users[0].id });
    const cleared = await request(app).patch(`/api/v1/projects/${project.id}`).set(auth()).send({ description: '' }).expect(200);
    expect(cleared.body).toMatchObject({ name: 'Updated', description: '' });
  });
  it('rejects invalid and protected update fields without modifying the project', async () => {
    const project = await db.project.findFirstOrThrow({ where: { ownerId: users[0].id } });
    for (const input of [{}, { name: ' ' }, { name: 'x'.repeat(101) }, { description: 'x'.repeat(5001) }, { ownerId: users[1].id }]) {
      await request(app).patch(`/api/v1/projects/${project.id}`).set(auth()).send(input).expect(400);
    }
    expect(await db.project.findUnique({ where: { id: project.id } })).toEqual(project);
    const privateProject = await db.project.create({ data: { name: 'Private', ownerId: users[0].id, memberships: { create: { userId: users[0].id } } } });
    await request(app).patch(`/api/v1/projects/${privateProject.id}`).set(auth(1)).send({ name: 'Hidden' }).expect(404);
  });
});
