import { randomBytes } from 'node:crypto';
import { TaskStatus } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import * as activity from '../../src/activity.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
/** Authenticate a membership operation as the selected fixture account. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Create a project containing exactly the nominated fixture members. */
async function project(memberIndexes = [1, 2, 3]) {
  return db.project.create({ data: { name: 'Reassignment', ownerId: users[0].id, memberships: { create: [0, ...memberIndexes].map(index => ({ userId: users[index].id })) } } });
}
/** Create task persistence fixtures while task HTTP endpoints remain a subsequent batch. */
async function tasks(projectId: string, index: number, count: number, status: TaskStatus = TaskStatus.OPEN, deleted = false) {
  await db.task.createMany({ data: Array.from({ length: count }, (_, number) => ({ projectId, title: `Work ${number}`, assigneeId: users[index].id, createdById: users[0].id, status, deletedAt: deleted ? new Date() : null })) });
}
/** Address a member within this suite's project. */
const path = (projectId: string, index = 1) => `/api/v1/projects/${projectId}/members/${users[index].id}`;

describe('member removal and task reassignment', () => {
  beforeAll(async () => { users = await accounts(5); });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });
  it('previews and balances unfinished work, ignoring completed/deleted and other-project tasks', async () => {
    const team = await project();
    const other = await project([2]);
    await tasks(other.id, 2, 20);
    await tasks(team.id, 1, 3);
    await tasks(team.id, 1, 1, TaskStatus.IN_PROGRESS);
    await tasks(team.id, 1, 2, TaskStatus.COMPLETED);
    await tasks(team.id, 1, 1, TaskStatus.OPEN, true);
    await tasks(team.id, 2, 10, TaskStatus.COMPLETED);
    await tasks(team.id, 3, 10, TaskStatus.OPEN, true);
    await tasks(team.id, 3, 2);
    const preview = await request(app).post(path(team.id) + '/removal-preview').set(auth()).send({}).expect(200);
    expect(preview.body.unfinishedTasks).toBe(4);
    expect(preview.body.allocations).toEqual(expect.arrayContaining([
      { userId: users[2].id, currentTasks: 0, reassignedTasks: 3, resultingTasks: 3 },
      { userId: users[3].id, currentTasks: 2, reassignedTasks: 1, resultingTasks: 3 },
    ]));
    expect(await db.membership.count({ where: { projectId: team.id, userId: users[1].id } })).toBe(1);
    expect(await db.activity.count({ where: { projectId: team.id } })).toBe(0);
    const removed = await request(app).delete(path(team.id)).set(auth()).expect(200);
    expect(removed.body).toEqual(preview.body);
    expect(await db.task.count({ where: { projectId: team.id, assigneeId: users[1].id } })).toBe(3);
    expect(await db.task.count({ where: { projectId: team.id, assigneeId: users[0].id } })).toBe(0);
    expect(await db.activity.count({ where: { projectId: team.id, action: 'TASK_REASSIGNED' } })).toBe(4);
    expect(await db.activity.count({ where: { projectId: team.id, action: 'MEMBER_REMOVED' } })).toBe(1);
    await request(app).get(`/api/v1/projects/${team.id}`).set(auth(1)).expect(404);
  });
  it('lets the owner explicitly select one remaining member, including the owner', async () => {
    const team = await project();
    await tasks(team.id, 1, 3);
    await tasks(team.id, 0, 2);
    const body = { mode: 'MANUAL', replacementUserId: users[0].id };
    const removed = await request(app).delete(path(team.id)).set(auth()).send(body).expect(200);
    expect(removed.body.allocations).toEqual([{ userId: users[0].id, currentTasks: 2, reassignedTasks: 3, resultingTasks: 5 }]);
    expect(await db.task.count({ where: { projectId: team.id, assigneeId: users[0].id } })).toBe(5);
  });
  it('protects the owner and limits removal of others to the owner', async () => {
    const team = await project();
    await request(app).delete(path(team.id)).expect(401);
    await request(app).delete(path(team.id)).set(auth(4)).expect(404);
    await request(app).delete(path(team.id)).set(auth(2)).expect(403);
    await request(app).delete(path(team.id, 0)).set(auth()).expect(409);
    await request(app).post(path(team.id, 0) + '/removal-preview').set(auth()).send({}).expect(409);
    await request(app).delete(path(team.id, 4)).set(auth()).expect(404);
    expect(await db.membership.count({ where: { projectId: team.id } })).toBe(4);
  });
  it('validates manual replacements without changing membership or assignments', async () => {
    const team = await project();
    await tasks(team.id, 1, 1);
    for (const body of [{ mode: 'MANUAL' }, { mode: 'MANUAL', replacementUserId: users[1].id }, { mode: 'MANUAL', replacementUserId: users[4].id }, { mode: 'AUTOMATIC', replacementUserId: users[2].id }, { mode: 'invalid' }]) {
      await request(app).delete(path(team.id)).set(auth()).send(body).expect(400);
    }
    expect(await db.membership.count({ where: { projectId: team.id, userId: users[1].id } })).toBe(1);
    expect(await db.task.count({ where: { projectId: team.id, assigneeId: users[1].id } })).toBe(1);
  });
  it('allows a member to leave automatically and falls back to the owner', async () => {
    const team = await project([1]);
    await tasks(team.id, 1, 2);
    await request(app).delete(path(team.id)).set(auth(1)).send({ mode: 'MANUAL', replacementUserId: users[0].id }).expect(403);
    const left = await request(app).delete(path(team.id)).set(auth(1)).expect(200);
    expect(left.body.allocations[0]).toMatchObject({ userId: users[0].id, reassignedTasks: 2 });
    expect(await db.activity.count({ where: { projectId: team.id, action: 'MEMBER_LEFT' } })).toBe(1);
    expect(await db.membership.count({ where: { projectId: team.id } })).toBe(1);
  });
  it('allows the former owner to leave after transferring ownership', async () => {
    const team = await project([1]);
    await tasks(team.id, 0, 1);
    await request(app).post(`/api/v1/projects/${team.id}/ownership`).set(auth()).send({ newOwnerId: users[1].id }).expect(200);
    await request(app).delete(path(team.id, 0)).set(auth()).expect(200);
    expect(await db.task.count({ where: { projectId: team.id, assigneeId: users[1].id } })).toBe(1);
    expect((await db.project.findUniqueOrThrow({ where: { id: team.id } })).ownerId).toBe(users[1].id);
  });
  it('recomputes execution after a preview rather than applying stale workload counts', async () => {
    const team = await project();
    await tasks(team.id, 1, 1);
    await request(app).post(path(team.id) + '/removal-preview').set(auth()).send({}).expect(200);
    await tasks(team.id, 2, 5);
    const removed = await request(app).delete(path(team.id)).set(auth()).expect(200);
    expect(removed.body.allocations.find((item: { userId: string }) => item.userId === users[3].id).reassignedTasks).toBe(1);
  });
  it('serializes duplicate removals and records task reassignment once', async () => {
    const team = await project();
    await tasks(team.id, 1, 2);
    const results = await Promise.all([request(app).delete(path(team.id)).set(auth()), request(app).delete(path(team.id)).set(auth())]);
    expect(results.map(result => result.status).sort()).toEqual([200, 404]);
    expect(await db.activity.count({ where: { projectId: team.id, action: 'TASK_REASSIGNED' } })).toBe(2);
    expect(await db.membership.count({ where: { projectId: team.id } })).toBe(3);
  });
  it('revokes pending invitations on removal so old tokens cannot restore access', async () => {
    const team = await project([]);
    const issued = await request(app).post(`/api/v1/projects/${team.id}/invitations`).set(auth()).send({ email: users[1].email }).expect(201);
    await db.membership.create({ data: { projectId: team.id, userId: users[1].id } });
    await request(app).delete(path(team.id)).set(auth()).expect(200);
    await request(app).post('/api/v1/invitations/accept').set(auth(1)).send({ token: issued.body.token }).expect(400);
    expect((await db.invitation.findUniqueOrThrow({ where: { id: issued.body.invitation.id } })).revokedAt).not.toBeNull();
  });
  it('blocks removal on deleted projects and cascades tasks only on permanent purge', async () => {
    const team = await project([1]);
    await tasks(team.id, 1, 1);
    await request(app).delete(`/api/v1/projects/${team.id}`).set(auth()).expect(204);
    await request(app).delete(path(team.id)).set(auth()).expect(404);
    expect(await db.task.count({ where: { projectId: team.id, deletedAt: null } })).toBe(1);
    await request(app).delete(`/api/v1/projects/${team.id}/permanent`).set(auth()).expect(204);
    expect(await db.task.count({ where: { projectId: team.id } })).toBe(0);
  });
  it('rolls back assignments and membership when recording activity fails', async () => {
    const team = await project();
    await tasks(team.id, 1, 2);
    const failure = vi.spyOn(activity, 'recordActivities').mockRejectedValueOnce(new Error('Injected activity failure'));
    try {
      await request(app).delete(path(team.id)).set(auth()).expect(500);
      expect(await db.membership.count({ where: { projectId: team.id, userId: users[1].id } })).toBe(1);
      expect(await db.task.count({ where: { projectId: team.id, assigneeId: users[1].id } })).toBe(2);
      expect(await db.activity.count({ where: { projectId: team.id } })).toBe(0);
    } finally { failure.mockRestore(); }
  });
  it('handles reassignment and activity beyond a single SQL batch', async () => {
    const team = await project();
    await tasks(team.id, 1, 1100);
    const result = await request(app).delete(path(team.id)).set(auth()).expect(200);
    expect(result.body.unfinishedTasks).toBe(1100);
    expect(result.body.allocations.map((item: { resultingTasks: number }) => item.resultingTasks)).toEqual([550, 550]);
    expect(await db.activity.count({ where: { projectId: team.id, action: 'TASK_REASSIGNED' } })).toBe(1100);
    expect(await db.task.count({ where: { projectId: team.id, assigneeId: users[1].id } })).toBe(0);
  });
  it('rejects malformed identifiers and unknown fields', async () => {
    const team = await project();
    await request(app).post(path(team.id) + '/removal-preview').set(auth()).send({ extra: randomBytes(4).toString('hex') }).expect(400);
    await request(app).delete(`/api/v1/projects/${team.id}/members/invalid`).set(auth()).expect(400);
  });
});
