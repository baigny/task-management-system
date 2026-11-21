import { TaskStatus } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { accounts, cleanup } from './helpers.js';

const backslash = String.fromCharCode(92);
let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
let ownedProjectId: string;
let privateProjectId: string;
let taskId: string;
let privateTaskId: string;
let deletedTaskId: string;
/** Authenticate task discovery as a fixture account. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Address the project task collection and optional query string. */
const path = (query = '') => `/api/v1/projects/${projectId}/tasks${query}`;

describe('task reads and discovery', () => {
  beforeAll(async () => {
    users = await accounts(3);
    const project = await db.project.create({ data: { name: 'Visible tasks', ownerId: users[0].id, memberships: { create: [{ userId: users[0].id }, { userId: users[1].id }] } } });
    projectId = project.id;
    const own = await db.project.create({ data: { name: 'Member-owned project', ownerId: users[1].id, memberships: { create: { userId: users[1].id } } } });
    ownedProjectId = own.id;
    const hidden = await db.project.create({ data: { name: 'Private tasks', ownerId: users[2].id, memberships: { create: { userId: users[2].id } } } });
    privateProjectId = hidden.id;
    const task = await db.task.create({ data: { projectId, title: 'alpha', description: 'Release checklist', assigneeId: users[1].id, dueDate: new Date('2030-01-01T00:00:00Z') } });
    taskId = task.id;
    await db.task.createMany({ data: [
      { projectId, title: 'beta', status: TaskStatus.COMPLETED, assigneeId: users[0].id, dueDate: new Date('2031-01-01T00:00:00Z') },
      { projectId, title: '100% ready' }, { projectId, title: '1000 ready' },
      { projectId, title: 'v_1' }, { projectId, title: 'va1', status: TaskStatus.IN_PROGRESS, assigneeId: users[1].id },
      { projectId, title: 'path' + backslash + 'draft' }, { projectId, title: 'tie' }, { projectId, title: 'tie' },
      { projectId: ownedProjectId, title: 'gamma', assigneeId: users[1].id },
    ] });
    const deleted = await db.task.create({ data: { projectId, title: 'Deleted alpha', assigneeId: users[1].id, deletedAt: new Date() } });
    deletedTaskId = deleted.id;
    // A former member's completed task history must never bypass current project access.
    const historical = await db.task.create({ data: { projectId: privateProjectId, title: 'Private history', status: TaskStatus.COMPLETED, assigneeId: users[1].id } });
    privateTaskId = historical.id;
  });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('reads only current member-visible tasks in their actual project', async () => {
    expect((await request(app).get(path('/' + taskId)).set(auth(1)).expect(200)).body.title).toBe('alpha');
    await request(app).get(path('/' + taskId)).expect(401);
    await request(app).get(path('/' + taskId)).set(auth(2)).expect(404);
    await request(app).get(path('/' + privateTaskId)).set(auth()).expect(404);
    await request(app).get(path('/' + deletedTaskId)).set(auth()).expect(404);
  });
  it('paginates with stable ID ties and a consistent total', async () => {
    const all = await request(app).get(path()).set(auth()).expect(200);
    expect(all.body).toMatchObject({ total: 9, page: 1, limit: 20 });
    const first = await request(app).get(path('?search=tie&sortBy=title&sortOrder=asc&limit=1')).set(auth()).expect(200);
    const next = await request(app).get(path('?search=tie&sortBy=title&sortOrder=asc&limit=1&page=2')).set(auth()).expect(200);
    expect(first.body.total).toBe(2);
    expect(first.body.items[0].id < next.body.items[0].id).toBe(true);
    expect((await request(app).get(path('?page=20&limit=1')).set(auth()).expect(200)).body.items).toEqual([]);
  });
  it('combines status and assignee filters using the authenticated account for me', async () => {
    const mine = await request(app).get(path('?assigneeId=me&status=OPEN')).set(auth(1)).expect(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.items[0].id).toBe(taskId);
    expect((await request(app).get(path('?assigneeId=unassigned')).set(auth()).expect(200)).body.total).toBe(6);
    const owner = await request(app).get(path('?assigneeId=' + users[0].id)).set(auth(1)).expect(200);
    expect(owner.body.items[0].title).toBe('beta');
  });
  it('searches descriptions without interpreting percent, underscore, or backslash as wildcards', async () => {
    expect((await request(app).get(path('?search=CHECKLIST')).set(auth()).expect(200)).body.items[0].id).toBe(taskId);
    for (const [search, title] of [['100%', '100% ready'], ['v_1', 'v_1'], ['path' + backslash, 'path' + backslash + 'draft']]) {
      const result = await request(app).get(path('?search=' + encodeURIComponent(search))).set(auth()).expect(200);
      expect(result.body.total).toBe(1);
      expect(result.body.items[0].title).toBe(title);
    }
  });
  it('sorts due dates in either direction with missing dates last', async () => {
    const ascending = await request(app).get(path('?sortBy=dueDate&sortOrder=asc')).set(auth()).expect(200);
    expect(ascending.body.items.slice(0, 2).map((task: { title: string }) => task.title)).toEqual(['alpha', 'beta']);
    expect(ascending.body.items.slice(2).every((task: { dueDate: string | null }) => task.dueDate === null)).toBe(true);
    const descending = await request(app).get(path('?sortBy=dueDate&sortOrder=desc')).set(auth()).expect(200);
    expect(descending.body.items.slice(0, 2).map((task: { title: string }) => task.title)).toEqual(['beta', 'alpha']);
  });
  it('discovers assigned work across current memberships, including member-owned projects', async () => {
    const mine = await request(app).get('/api/v1/tasks?assigneeId=me').set(auth(1)).expect(200);
    expect(mine.body.total).toBe(3);
    expect(mine.body.items.some((task: { projectId: string }) => task.projectId === ownedProjectId)).toBe(true);
    expect(mine.body.items.every((task: { projectId: string }) => task.projectId !== privateProjectId)).toBe(true);
    const filtered = await request(app).get('/api/v1/tasks?projectId=' + ownedProjectId).set(auth(1)).expect(200);
    expect(filtered.body.total).toBe(1);
    expect((await request(app).get('/api/v1/tasks?projectId=' + privateProjectId).set(auth(1)).expect(200)).body.total).toBe(0);
    await request(app).get('/api/v1/tasks').expect(401);
  });
  it('rejects invalid filters, sort fields, identifiers, and unknown query parameters', async () => {
    for (const query of ['status=DONE', 'assigneeId=invalid', 'sortBy=assigneeId', 'sortBy=__proto__', 'sortOrder=DESC', 'limit=101', 'page=0', 'search=%20', 'unknown=value']) {
      await request(app).get(path('?' + query)).set(auth()).expect(400);
    }
    await request(app).get('/api/v1/tasks?projectId=invalid').set(auth()).expect(400);
    await request(app).get(path('/invalid')).set(auth()).expect(400);
  });
  it('revokes task discovery access on member removal without affecting other memberships', async () => {
    await request(app).delete(`/api/v1/projects/${projectId}/members/${users[1].id}`).set(auth()).expect(200);
    await request(app).get(path()).set(auth(1)).expect(404);
    await request(app).get(path('/' + taskId)).set(auth(1)).expect(404);
    const mine = await request(app).get('/api/v1/tasks?assigneeId=me').set(auth(1)).expect(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.items[0].projectId).toBe(ownedProjectId);
  });
  it('hides all child tasks when the parent project is soft-deleted', async () => {
    await request(app).delete(`/api/v1/projects/${projectId}`).set(auth()).expect(204);
    await request(app).get(path()).set(auth()).expect(404);
    await request(app).get(path('/' + taskId)).set(auth()).expect(404);
    expect((await request(app).get('/api/v1/tasks').set(auth()).expect(200)).body.total).toBe(0);
    expect(await db.task.count({ where: { projectId, deletedAt: null } })).toBe(9);
  });
});
