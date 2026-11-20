import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import * as activity from '../../src/activity.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
let taskId: string;
let otherTaskId: string;
let rootId: string;
let replyId: string;
/** Bind fixture requests to a current member or an outsider. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Build a task-scoped thread endpoint for this suite's fixtures. */
const path = (suffix = '', task = taskId) => `/api/v1/projects/${projectId}/tasks/${task}/comments${suffix}`;

describe('task comment threads', () => {
  beforeAll(async () => {
    users = await accounts(4);
    projectId = (await request(app).post('/api/v1/projects').set(auth()).send({ name: 'Threads' }).expect(201)).body.id;
    await db.membership.createMany({ data: users.slice(1, 3).map(user => ({ projectId, userId: user.id })) });
    taskId = (await db.task.create({ data: { projectId, title: 'Discuss this' } })).id;
    otherTaskId = (await db.task.create({ data: { projectId, title: 'Different task' } })).id;
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });

  it('requires authentication and membership for every thread operation', async () => {
    await request(app).get(path()).expect(401);
    await request(app).post(path()).set(auth(3)).send({ body: 'Hidden' }).expect(404);
    await request(app).get(path()).set(auth(3)).expect(404);
  });
  it('validates text, protected fields, and bounded pagination', async () => {
    for (const body of [{ body: ' ' }, { body: 'x'.repeat(5001) }, { body: 'Hi', authorId: users[0].id }, { body: 'Hi', parentId: 'invalid' }]) {
      await request(app).post(path()).set(auth(1)).send(body).expect(400);
    }
    await request(app).get(path('?limit=101')).set(auth()).expect(400);
    await request(app).get(path('?unknown=1')).set(auth()).expect(400);
  });
  it('creates a root and a reply with public authors and transactional activity', async () => {
    const root = await request(app).post(path()).set(auth(1)).send({ body: '  Review the deadline  ' }).expect(201);
    rootId = root.body.id;
    expect(root.body).toMatchObject({ body: 'Review the deadline', parentId: null, authorId: users[1].id, _count: { replies: 0 } });
    expect(root.body.author).not.toHaveProperty('passwordHash');
    const reply = await request(app).post(path()).set(auth(2)).send({ body: 'Agreed', parentId: rootId }).expect(201);
    replyId = reply.body.id;
    expect(reply.body.parentId).toBe(rootId);
    expect(await db.activity.count({ where: { projectId, action: 'COMMENT_CREATED' } })).toBe(2);
  });
  it('keeps thread roots and replies independently paginated', async () => {
    const roots = await request(app).get(path('?limit=1')).set(auth()).expect(200);
    expect(roots.body).toMatchObject({ total: 1, page: 1, limit: 1 });
    expect(roots.body.items[0]).toMatchObject({ id: rootId, _count: { replies: 1 } });
    const replies = await request(app).get(path(`/${rootId}/replies`)).set(auth()).expect(200);
    expect(replies.body.items.map((item: { id: string }) => item.id)).toEqual([replyId]);
    expect((await request(app).get(path(`/${rootId}/replies?page=2&limit=1`)).set(auth()).expect(200)).body.items).toEqual([]);
  });
  it('rejects cross-task parent IDs, cross-task deletion, and deeper nesting', async () => {
    await request(app).post(path('', otherTaskId)).set(auth()).send({ body: 'Wrong task', parentId: rootId }).expect(404);
    await request(app).delete(path(`/${rootId}`, otherTaskId)).set(auth()).expect(404);
    await request(app).post(path()).set(auth()).send({ body: 'Too deep', parentId: replyId }).expect(400);
    await request(app).get(path(`/${replyId}/replies`)).set(auth()).expect(404);
    await request(app).get(path(`/${rootId}/replies`)).set(auth(3)).expect(404);
  });
  it('restricts deletion and preserves replies when the owner removes root text', async () => {
    await request(app).delete(path(`/${rootId}`)).set(auth(2)).expect(403);
    await request(app).delete(path(`/${rootId}`)).set(auth(3)).expect(404);
    await request(app).delete(path(`/${rootId}`)).set(auth()).expect(204);
    await request(app).delete(path(`/${rootId}`)).set(auth()).expect(204);
    expect(await db.comment.findUnique({ where: { id: rootId } })).toMatchObject({ body: null, deletedAt: expect.any(Date) });
    expect((await request(app).get(path(`/${rootId}/replies`)).set(auth(1)).expect(200)).body.total).toBe(1);
    await request(app).post(path()).set(auth(1)).send({ body: 'Continue discussion', parentId: rootId }).expect(201);
    await request(app).delete(path(`/${replyId}`)).set(auth(2)).expect(204);
    expect(await db.activity.count({ where: { projectId, action: 'COMMENT_DELETED' } })).toBe(2);
  });
  it('rolls back comment creation and deletion if activity persistence fails', async () => {
    const before = await db.comment.count({ where: { taskId } });
    vi.spyOn(activity, 'recordActivity').mockRejectedValueOnce(new Error('Injected comment activity failure'));
    await request(app).post(path()).set(auth()).send({ body: 'Rolled back' }).expect(500);
    expect(await db.comment.count({ where: { taskId } })).toBe(before);
    const live = await db.comment.findFirstOrThrow({ where: { taskId, deletedAt: null } });
    vi.spyOn(activity, 'recordActivity').mockRejectedValueOnce(new Error('Injected comment deletion failure'));
    await request(app).delete(path(`/${live.id}`)).set(auth()).expect(500);
    expect(await db.comment.findUnique({ where: { id: live.id } })).toMatchObject({ body: live.body, deletedAt: null });
  });
  it('allows multiple independent new threads on the same task', async () => {
    const second = await request(app).post(path()).set(auth(2)).send({ body: 'Separate discussion' }).expect(201);
    expect(second.body).toMatchObject({ parentId: null, _count: { replies: 0 } });
    const firstPage = (await request(app).get(path('?page=1&limit=1')).set(auth()).expect(200)).body;
    const nextPage = (await request(app).get(path('?page=2&limit=1')).set(auth()).expect(200)).body;
    expect(firstPage.total).toBe(2);
    expect(new Set([firstPage.items[0].id, nextPage.items[0].id])).toEqual(new Set([rootId, second.body.id]));
  });
  it('hides comments during task/project deletion and preserves them across restoration', async () => {
    const taskPath = `/api/v1/projects/${projectId}/tasks/${taskId}`;
    await request(app).delete(taskPath).set(auth(1)).expect(204);
    await request(app).get(path()).set(auth()).expect(404);
    await request(app).post(path()).set(auth()).send({ body: 'Hidden' }).expect(404);
    await request(app).post(`${taskPath}/restore`).set(auth()).expect(200);
    await request(app).delete(`/api/v1/projects/${projectId}`).set(auth()).expect(204);
    await request(app).get(path(`/${rootId}/replies`)).set(auth()).expect(404);
    await request(app).post(`/api/v1/projects/${projectId}/restore`).set(auth()).expect(200);
    expect((await request(app).get(path()).set(auth()).expect(200)).body.total).toBe(2);
  });
  it('revokes access when an author leaves the project', async () => {
    await request(app).delete(`/api/v1/projects/${projectId}/members/${users[1].id}`).set(auth()).expect(200);
    await request(app).get(path()).set(auth(1)).expect(404);
    await request(app).delete(path(`/${rootId}`)).set(auth(1)).expect(404);
    await request(app).post(path()).set(auth(1)).send({ body: 'No longer member' }).expect(404);
  });
  it('cascades a task purge through all roots and replies', async () => {
    const taskPath = `/api/v1/projects/${projectId}/tasks/${taskId}`;
    await request(app).delete(taskPath).set(auth()).expect(204);
    await request(app).delete(`${taskPath}/permanent`).set(auth()).expect(204);
    expect(await db.comment.count({ where: { taskId } })).toBe(0);
  });
  it('cascades a project purge through remaining task comments', async () => {
    await request(app).post(path('', otherTaskId)).set(auth()).send({ body: 'Project child' }).expect(201);
    await request(app).delete(`/api/v1/projects/${projectId}`).set(auth()).expect(204);
    await request(app).delete(`/api/v1/projects/${projectId}/permanent`).set(auth()).expect(204);
    expect(await db.comment.count({ where: { taskId: otherTaskId } })).toBe(0);
  });
});
