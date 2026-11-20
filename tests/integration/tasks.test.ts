import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import * as activity from '../../src/activity.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
/** Authenticate task creation as the chosen fixture account. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Address the project-scoped task collection. */
const path = () => `/api/v1/projects/${projectId}/tasks`;

describe('task creation', () => {
  beforeAll(async () => {
    users = await accounts(3);
    const project = await db.project.create({ data: { name: 'Tasks', ownerId: users[0].id, memberships: { create: [{ userId: users[0].id }, { userId: users[1].id }] } } });
    projectId = project.id;
    await db.project.create({ data: { name: 'Other team', ownerId: users[2].id, memberships: { create: { userId: users[2].id } } } });
  });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('allows members to create tasks with safe defaults and transactional activity', async () => {
    const result = await request(app).post(path()).set(auth(1)).send({ title: ' Prepare release ' }).expect(201);
    expect(result.body).toMatchObject({ title: 'Prepare release', description: '', status: 'OPEN', assigneeId: null, dueDate: null, createdById: users[1].id, projectId, deletedAt: null, deletedById: null });
    expect(await db.activity.count({ where: { projectId, action: 'TASK_CREATED', entityId: result.body.id, actorId: users[1].id } })).toBe(1);
  });
  it('accepts a current project assignee, explicit status, and timezone-aware due date', async () => {
    const result = await request(app).post(path()).set(auth()).send({ title: 'Assigned task', description: 'Release checklist', status: 'IN_PROGRESS', assigneeId: users[1].id, dueDate: '2027-01-31T12:00:00+05:30' }).expect(201);
    expect(result.body).toMatchObject({ assigneeId: users[1].id, status: 'IN_PROGRESS', dueDate: '2027-01-31T06:30:00.000Z' });
    await request(app).post(path()).set(auth()).send({ title: 'Explicitly unassigned', assigneeId: null, dueDate: null }).expect(201);
  });
  it('enforces project isolation and rejects assignees from another project', async () => {
    await request(app).post(path()).send({ title: 'Missing token' }).expect(401);
    await request(app).post(path()).set(auth(2)).send({ title: 'Hidden' }).expect(404);
    await request(app).post(path()).set(auth()).send({ title: 'Wrong assignee', assigneeId: users[2].id }).expect(400);
  });
  it('rejects invalid content, invalid dates, and supplied ownership/deletion fields', async () => {
    for (const input of [{ title: ' ' }, { title: 'x'.repeat(201) }, { title: 'Task', description: 'x'.repeat(10001) }, { title: 'Task', status: 'DONE' }, { title: 'Task', dueDate: '2027-02-30T12:00:00Z' }, { title: 'Task', dueDate: '2027-01-31T12:00:00' }, { title: 'Task', assigneeId: 'invalid' }, { title: 'Task', projectId }, { title: 'Task', createdById: users[1].id }, { title: 'Task', deletedAt: new Date().toISOString() }]) {
      await request(app).post(path()).set(auth()).send(input).expect(400);
    }
    expect(await db.task.count({ where: { projectId } })).toBe(3);
  });
  it('rolls back task creation if its activity cannot be persisted', async () => {
    const failure = vi.spyOn(activity, 'recordActivity').mockRejectedValueOnce(new Error('Injected activity failure'));
    try {
      await request(app).post(path()).set(auth()).send({ title: 'Must roll back' }).expect(500);
      expect(await db.task.count({ where: { projectId, title: 'Must roll back' } })).toBe(0);
    } finally { failure.mockRestore(); }
  });
  it('prevents creating tasks in a deleted project', async () => {
    await request(app).delete(`/api/v1/projects/${projectId}`).set(auth()).expect(204);
    await request(app).post(path()).set(auth()).send({ title: 'Deleted project' }).expect(404);
  });
});
