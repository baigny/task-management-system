import type { Task } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import * as activity from '../../src/activity.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
/** Authenticate lifecycle requests with a fixture account. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Create a fresh project so membership/deletion transitions do not couple scenarios. */
async function project(memberIndexes = [1, 2], ownerIndex = 0) {
  return db.project.create({ data: { name: 'Task lifecycle', ownerId: users[ownerIndex].id, memberships: { create: [ownerIndex, ...memberIndexes].map(index => ({ userId: users[index].id })) } } });
}
/** Create a task whose original status, due date, and assignment can be checked after restore. */
async function task(projectId: string, fields: Partial<Pick<Task, 'assigneeId' | 'status'>> = {}) {
  return db.task.create({ data: { projectId, title: 'Recoverable task', description: 'Preserve this', status: 'IN_PROGRESS', assigneeId: users[1].id, dueDate: new Date('2027-01-31T12:00:00Z'), ...fields } });
}
/** Address a task under its own project. */
const path = (item: Task, suffix = '') => `/api/v1/projects/${item.projectId}/tasks/${item.id}${suffix}`;

describe('task deletion and restoration lifecycle', () => {
  beforeAll(async () => { users = await accounts(4); });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('lets members soft-delete tasks and hides them from ordinary reads and discovery', async () => {
    const team = await project();
    const item = await task(team.id);
    await request(app).delete(path(item)).set(auth(1)).expect(204);
    const saved = await db.task.findUniqueOrThrow({ where: { id: item.id } });
    expect(saved.deletedAt).toBeInstanceOf(Date);
    expect(saved.deletedById).toBe(users[1].id);
    await request(app).get(path(item)).set(auth()).expect(404);
    await request(app).patch(path(item)).set(auth()).send({ title: 'Hidden' }).expect(404);
    expect((await request(app).get(`/api/v1/tasks?projectId=${team.id}`).set(auth()).expect(200)).body.items).toEqual([]);
    await request(app).delete(path(item)).set(auth()).expect(404);
    expect(await db.activity.count({ where: { entityId: item.id, action: 'TASK_DELETED' } })).toBe(1);
  });
  it('restricts trash, restoration, and permanent deletion to the current owner', async () => {
    const team = await project();
    const item = await task(team.id);
    await request(app).delete(path(item)).set(auth(1)).expect(204);
    await request(app).get(`/api/v1/projects/${team.id}/tasks?deleted=true`).set(auth(1)).expect(403);
    await request(app).post(path(item, '/restore')).set(auth(1)).expect(403);
    await request(app).delete(path(item, '/permanent')).set(auth(1)).expect(403);
    await request(app).post(path(item, '/restore')).set(auth(3)).expect(404);
    const trash = await request(app).get(`/api/v1/projects/${team.id}/tasks?deleted=true`).set(auth()).expect(200);
    expect(trash.body.items[0].id).toBe(item.id);
    await request(app).post(`/api/v1/projects/${team.id}/ownership`).set(auth()).send({ newOwnerId: users[2].id }).expect(200);
    await request(app).post(path(item, '/restore')).set(auth()).expect(403);
    await request(app).post(path(item, '/restore')).set(auth(2)).expect(200);
  });
  it('lists cross-project trash only from caller-owned active projects', async () => {
    const own = await project();
    const other = await project([0], 1);
    const first = await task(own.id);
    const second = await task(other.id);
    await request(app).delete(path(first)).set(auth()).expect(204);
    await request(app).delete(path(second)).set(auth(1)).expect(204);
    const trash = await request(app).get('/api/v1/tasks?deleted=true').set(auth()).expect(200);
    expect(trash.body.items.some((item: { id: string }) => item.id === first.id)).toBe(true);
    expect(trash.body.items.some((item: { id: string }) => item.id === second.id)).toBe(false);
  });
  it('restores original fields and a still-valid assignee and rejects active-task restore', async () => {
    const team = await project();
    const item = await task(team.id);
    await request(app).delete(path(item)).set(auth(1)).expect(204);
    const result = await request(app).post(path(item, '/restore')).set(auth()).expect(200);
    expect(result.body).toMatchObject({ status: item.status, description: item.description, dueDate: item.dueDate?.toISOString(), assigneeId: users[1].id, deletedAt: null, deletedById: null });
    await request(app).get(path(item)).set(auth(1)).expect(200);
    await request(app).post(path(item, '/restore')).set(auth()).expect(409);
  });
  it('replaces departed assignees using workload balancing and records the historical assignment', async () => {
    const team = await project();
    const item = await task(team.id);
    await request(app).delete(path(item)).set(auth(1)).expect(204);
    await request(app).delete(`/api/v1/projects/${team.id}/members/${users[1].id}`).set(auth()).expect(200);
    const result = await request(app).post(path(item, '/restore')).set(auth()).expect(200);
    expect(result.body.assigneeId).toBe(users[2].id);
    expect(await db.activity.findFirst({ where: { entityId: item.id, action: 'TASK_REASSIGNED' } })).toMatchObject({ metadata: { previousAssigneeId: users[1].id, assigneeId: users[2].id, reason: 'TASK_RESTORE' } });
  });
  it('falls back to the owner and keeps explicitly unassigned tasks unassigned', async () => {
    const team = await project([1]);
    const assigned = await task(team.id);
    const unassigned = await task(team.id, { assigneeId: null });
    await request(app).delete(path(assigned)).set(auth()).expect(204);
    await request(app).delete(path(unassigned)).set(auth()).expect(204);
    await request(app).delete(`/api/v1/projects/${team.id}/members/${users[1].id}`).set(auth()).expect(200);
    expect((await request(app).post(path(assigned, '/restore')).set(auth()).expect(200)).body.assigneeId).toBe(users[0].id);
    expect((await request(app).post(path(unassigned, '/restore')).set(auth()).expect(200)).body.assigneeId).toBeNull();
  });
  it('preserves individual task trash states across parent deletion and restoration', async () => {
    const team = await project();
    const active = await task(team.id);
    const trashed = await task(team.id);
    await request(app).delete(path(trashed)).set(auth(1)).expect(204);
    const deletion = (await db.task.findUniqueOrThrow({ where: { id: trashed.id } })).deletedAt;
    await request(app).delete(`/api/v1/projects/${team.id}`).set(auth()).expect(204);
    await request(app).get(path(active)).set(auth()).expect(404);
    await request(app).post(path(trashed, '/restore')).set(auth()).expect(404);
    await request(app).delete(path(trashed, '/permanent')).set(auth()).expect(404);
    await request(app).get(`/api/v1/projects/${team.id}/tasks?deleted=true`).set(auth()).expect(404);
    await request(app).post(`/api/v1/projects/${team.id}/restore`).set(auth()).expect(200);
    await request(app).get(path(active)).set(auth(1)).expect(200);
    await request(app).get(path(trashed)).set(auth()).expect(404);
    expect((await db.task.findUniqueOrThrow({ where: { id: trashed.id } })).deletedAt).toEqual(deletion);
  });
  it('purges only already deleted tasks and retains project activity', async () => {
    const team = await project();
    const item = await task(team.id);
    await request(app).delete(path(item, '/permanent')).set(auth()).expect(409);
    await request(app).delete(path(item)).set(auth(1)).expect(204);
    await request(app).delete(path(item, '/permanent')).set(auth()).expect(204);
    expect(await db.task.count({ where: { id: item.id } })).toBe(0);
    expect(await db.activity.count({ where: { projectId: team.id, entityId: item.id, action: 'TASK_PURGED' } })).toBe(1);
    await request(app).post(path(item, '/restore')).set(auth()).expect(404);
  });
  it('rolls back restoration and reassignment if activity persistence fails', async () => {
    const team = await project();
    const item = await task(team.id);
    await request(app).delete(path(item)).set(auth(1)).expect(204);
    await request(app).delete(`/api/v1/projects/${team.id}/members/${users[1].id}`).set(auth()).expect(200);
    const before = await db.task.findUniqueOrThrow({ where: { id: item.id } });
    const failure = vi.spyOn(activity, 'recordActivity').mockRejectedValueOnce(new Error('Injected activity failure'));
    try {
      await request(app).post(path(item, '/restore')).set(auth()).expect(500);
      expect(await db.task.findUnique({ where: { id: item.id } })).toEqual(before);
    } finally { failure.mockRestore(); }
  });
  it('serializes competing restores and validates trash flags', async () => {
    const team = await project();
    const item = await task(team.id);
    await request(app).delete(path(item)).set(auth()).expect(204);
    const results = await Promise.all([request(app).post(path(item, '/restore')).set(auth()), request(app).post(path(item, '/restore')).set(auth())]);
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await db.activity.count({ where: { entityId: item.id, action: 'TASK_RESTORED' } })).toBe(1);
    await request(app).get('/api/v1/tasks?deleted=invalid').set(auth()).expect(400);
    await request(app).get(`/api/v1/projects/${team.id}/tasks?deleted=invalid`).set(auth()).expect(400);
  });
});
