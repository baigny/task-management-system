import type { Task } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import * as activity from '../../src/activity.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
/** Authenticate task edits as one of the fixture accounts. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Create an independent project for concurrency and history scenarios. */
async function project(memberIndexes = [1, 2], ownerIndex = 0) {
  return db.project.create({ data: { name: 'Task updates', ownerId: users[ownerIndex].id, memberships: { create: [ownerIndex, ...memberIndexes].map(index => ({ userId: users[index].id })) } } });
}
/** Create a baseline task with enough fields to detect accidental update defaults. */
async function task(teamId = projectId, fields: Partial<Pick<Task, 'assigneeId' | 'status' | 'deletedAt' | 'createdById'>> = {}) {
  return db.task.create({ data: { projectId: teamId, title: 'Original', description: 'Keep description', dueDate: new Date('2027-01-31T12:00:00Z'), createdById: users[0].id, ...fields } });
}
/** Address a task within the requested project. */
const path = (taskId: string, teamId = projectId) => `/api/v1/projects/${teamId}/tasks/${taskId}`;

describe('task updates and assignment', () => {
  beforeAll(async () => { users = await accounts(4); projectId = (await project()).id; });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('allows members to complete tasks and preserves omitted fields', async () => {
    const item = await task();
    const changed = await request(app).patch(path(item.id)).set(auth(1)).send({ title: ' Updated ', status: 'COMPLETED' }).expect(200);
    expect(changed.body).toMatchObject({ title: 'Updated', status: 'COMPLETED', description: 'Keep description', dueDate: item.dueDate?.toISOString(), createdById: users[0].id });
    const cleared = await request(app).patch(path(item.id)).set(auth()).send({ description: '', dueDate: null }).expect(200);
    expect(cleared.body).toMatchObject({ title: 'Updated', status: 'COMPLETED', description: '', dueDate: null });
  });
  it('assigns or unassigns current members and records each assignment change', async () => {
    const item = await task();
    const assigned = await request(app).patch(path(item.id)).set(auth(1)).send({ assigneeId: users[2].id }).expect(200);
    expect(assigned.body.assigneeId).toBe(users[2].id);
    expect((await request(app).patch(path(item.id)).set(auth()).send({ assigneeId: null }).expect(200)).body.assigneeId).toBeNull();
    expect(await db.activity.count({ where: { projectId, entityId: item.id, action: 'TASK_REASSIGNED' } })).toBe(2);
    await request(app).patch(path(item.id)).set(auth()).send({ assigneeId: users[3].id }).expect(400);
  });
  it('rejects invalid/protected fields without changing the task', async () => {
    const item = await task();
    for (const input of [{}, { title: ' ' }, { status: 'DONE' }, { status: null }, { description: null }, { dueDate: '2027-01-31' }, { projectId }, { createdById: users[1].id }, { deletedAt: new Date().toISOString() }]) {
      await request(app).patch(path(item.id)).set(auth()).send(input).expect(400);
    }
    expect(await db.task.findUnique({ where: { id: item.id } })).toEqual(item);
  });
  it('requires project membership and conceals foreign or deleted resources', async () => {
    const item = await task();
    await request(app).patch(path(item.id)).send({ title: 'No auth' }).expect(401);
    await request(app).patch(path(item.id)).set(auth(3)).send({ title: 'Hidden' }).expect(404);
    const other = await project([], 3);
    const foreign = await task(other.id, { createdById: users[3].id });
    await request(app).patch(path(foreign.id)).set(auth()).send({ title: 'Wrong project' }).expect(404);
    const deleted = await task(projectId, { deletedAt: new Date() });
    await request(app).patch(path(deleted.id)).set(auth()).send({ title: 'Trash' }).expect(404);
    const archived = await project();
    const child = await task(archived.id);
    await request(app).delete(`/api/v1/projects/${archived.id}`).set(auth()).expect(204);
    await request(app).patch(path(child.id, archived.id)).set(auth()).send({ title: 'Archived' }).expect(404);
  });
  it('preserves timestamps and skips activity for updates that change nothing', async () => {
    const item = await task();
    const result = await request(app).patch(path(item.id)).set(auth()).send({ title: ' Original ', dueDate: '2027-01-31T17:30:00+05:30' }).expect(200);
    expect(result.body.updatedAt).toBe(item.updatedAt.toISOString());
    expect(await db.activity.count({ where: { entityId: item.id } })).toBe(0);
    expect(await db.task.findUnique({ where: { id: item.id } })).toEqual(item);
  });
  it('preserves independent edits made concurrently', async () => {
    const item = await task();
    const results = await Promise.all([
      request(app).patch(path(item.id)).set(auth()).send({ title: 'Concurrent title' }),
      request(app).patch(path(item.id)).set(auth(1)).send({ description: 'Concurrent description' }),
    ]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(await db.task.findUnique({ where: { id: item.id } })).toMatchObject({ title: 'Concurrent title', description: 'Concurrent description' });
  });
  it('coordinates assignment with concurrent member removal', async () => {
    const team = await project();
    const item = await task(team.id, { assigneeId: users[0].id });
    const [assignment, removal] = await Promise.all([
      request(app).patch(path(item.id, team.id)).set(auth()).send({ assigneeId: users[1].id }),
      request(app).delete(`/api/v1/projects/${team.id}/members/${users[1].id}`).set(auth()),
    ]);
    expect([200, 400]).toContain(assignment.status);
    expect(removal.status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: item.id } })).assigneeId).not.toBe(users[1].id);
    expect(await db.membership.count({ where: { projectId: team.id, userId: users[1].id } })).toBe(0);
  });
  it('keeps completed historical assignees while validating any explicit new assignment', async () => {
    const team = await project();
    const item = await task(team.id, { status: 'COMPLETED', assigneeId: users[1].id });
    await request(app).delete(`/api/v1/projects/${team.id}/members/${users[1].id}`).set(auth()).expect(200);
    const edited = await request(app).patch(path(item.id, team.id)).set(auth(2)).send({ description: 'Historical completion' }).expect(200);
    expect(edited.body.assigneeId).toBe(users[1].id);
    await request(app).patch(path(item.id, team.id)).set(auth()).send({ assigneeId: users[1].id }).expect(400);
    await request(app).patch(path(item.id, team.id)).set(auth()).send({ assigneeId: users[0].id }).expect(200);
  });
  it('rolls back updates if activity persistence fails', async () => {
    const item = await task();
    const failure = vi.spyOn(activity, 'recordActivity').mockRejectedValueOnce(new Error('Injected activity failure'));
    try {
      await request(app).patch(path(item.id)).set(auth()).send({ title: 'Must roll back' }).expect(500);
      expect(await db.task.findUnique({ where: { id: item.id } })).toEqual(item);
      expect(await db.activity.count({ where: { entityId: item.id } })).toBe(0);
    } finally { failure.mockRestore(); }
  });
});
