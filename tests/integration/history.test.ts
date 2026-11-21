import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
let taskId: string;
/** Authenticate fixture requests without coupling history tests to login throttles. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Select project or task history for this suite. */
const path = (task = false) => `/api/v1/projects/${projectId}${task ? `/tasks/${taskId}` : ''}/activity`;

describe('activity timelines', () => {
  beforeAll(async () => {
    users = await accounts(3);
    projectId = (await request(app).post('/api/v1/projects').set(auth()).send({ name: 'History' }).expect(201)).body.id;
    await db.membership.create({ data: { projectId, userId: users[1].id } });
    taskId = (await request(app).post(`/api/v1/projects/${projectId}/tasks`).set(auth()).send({ title: 'Audit task' }).expect(201)).body.id;
  });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('records task and comment events with public actors and supports filters', async () => {
    await request(app).post(`/api/v1/projects/${projectId}/tasks/${taskId}/comments`).set(auth(1)).send({ body: 'Private discussion text' }).expect(201);
    const all = await request(app).get(path(true)).set(auth(1)).expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items.every((item: { taskId: string }) => item.taskId === taskId)).toBe(true);
    expect(Object.keys(all.body.items[0].actor).sort()).toEqual(['id', 'name']);
    expect(JSON.stringify(all.body)).not.toContain('Private discussion text');
    const filtered = await request(app).get(`${path()}?taskId=${taskId}&action=COMMENT_CREATED&actorId=${users[1].id}&limit=1`).set(auth()).expect(200);
    expect(filtered.body).toMatchObject({ total: 1, page: 1, limit: 1 });
    expect(filtered.body.items[0].action).toBe('COMMENT_CREATED');
    expect((await request(app).get(`${path(true)}?page=3&limit=1`).set(auth()).expect(200)).body.items).toEqual([]);
  });
  it('rejects invalid queries and isolates projects and accounts', async () => {
    await request(app).get(path()).expect(401);
    await request(app).get(path(true)).set(auth(2)).expect(404);
    for (const query of ['action=UNKNOWN', 'limit=101', 'actorId=invalid', 'unknown=1']) await request(app).get(`${path()}?${query}`).set(auth()).expect(400);
    const other = await db.project.create({ data: { name: 'Other', ownerId: users[0].id, memberships: { create: { userId: users[0].id } } } });
    await request(app).get(`/api/v1/projects/${other.id}/tasks/${taskId}/activity`).set(auth()).expect(404);
  });
  it('reserves trash history for the owner and preserves historical IDs on task purge', async () => {
    const taskPath = `/api/v1/projects/${projectId}/tasks/${taskId}`;
    await request(app).delete(taskPath).set(auth(1)).expect(204);
    await request(app).get(path(true)).set(auth(1)).expect(404);
    await request(app).get(path(true)).set(auth()).expect(200);
    await request(app).delete(`/api/v1/projects/${projectId}`).set(auth()).expect(204);
    await request(app).get(path()).set(auth(1)).expect(404);
    await request(app).get(path(true)).set(auth()).expect(200);
    await request(app).post(`/api/v1/projects/${projectId}/restore`).set(auth()).expect(200);
    await request(app).delete(`${taskPath}/permanent`).set(auth()).expect(204);
    await request(app).get(path(true)).set(auth()).expect(404);
    const result = await request(app).get(`${path()}?action=TASK_PURGED`).set(auth()).expect(200);
    expect(result.body.items[0]).toMatchObject({ taskId: null, entityId: taskId });
    expect(await db.activity.count({ where: { projectId, action: 'COMMENT_CREATED' } })).toBe(1);
    await request(app).delete(`/api/v1/projects/${projectId}/members/${users[1].id}`).set(auth()).expect(200);
    await request(app).get(path()).set(auth(1)).expect(404);
  });
});
