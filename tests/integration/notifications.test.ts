import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import * as writes from '../../src/notifications/write.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
let taskId: string;
/** Select the acting fixture account. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Address the fixture task or one of its collaboration endpoints. */
const taskPath = (suffix = '') => `/api/v1/projects/${projectId}/tasks/${taskId}${suffix}`;
/** Read a recipient inbox using the same authorization rules as production. */
const inbox = (index = 1, query = '') => request(app).get(`/api/v1/notifications${query}`).set(auth(index));

describe('persisted notification inbox', () => {
  beforeAll(async () => {
    users = await accounts(4);
    projectId = (await request(app).post('/api/v1/projects').set(auth()).send({ name: 'Notifications' }).expect(201)).body.id;
    await db.membership.createMany({ data: users.slice(1, 3).map(user => ({ projectId, userId: user.id })) });
    taskId = (await request(app).post(`/api/v1/projects/${projectId}/tasks`).set(auth()).send({ title: 'Notice task', assigneeId: users[1].id }).expect(201)).body.id;
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await cleanup(users.map(user => user.id)); });

  it('persists assignment context and excludes self/no-op notifications', async () => {
    const result = await inbox().expect(200);
    expect(result.body).toMatchObject({ total: 1, unreadCount: 1 });
    expect(result.body.items[0]).toMatchObject({ type: 'TASK_ASSIGNED', projectId, taskId, actor: { id: users[0].id }, task: { title: 'Notice task' } });
    expect(result.body.items[0].message).toContain('assigned you a task');
    await request(app).patch(taskPath()).set(auth(1)).send({ description: 'My edit' }).expect(200);
    await request(app).patch(taskPath()).set(auth()).send({ description: 'My edit' }).expect(200);
    expect((await inbox().expect(200)).body.total).toBe(1);
    await request(app).patch(taskPath()).set(auth()).send({ status: 'IN_PROGRESS' }).expect(200);
    expect((await inbox().expect(200)).body.items[0]).toMatchObject({ type: 'TASK_UPDATED', metadata: { fields: ['status'] } });
  });
  it('notifies old and new assignees once on reassignment', async () => {
    await request(app).patch(taskPath()).set(auth()).send({ assigneeId: users[2].id }).expect(200);
    expect((await inbox().expect(200)).body.items[0].type).toBe('TASK_UNASSIGNED');
    expect((await inbox(2).expect(200)).body.items[0].type).toBe('TASK_ASSIGNED');
    expect((await inbox(0).expect(200)).body.total).toBe(0);
  });
  it('deduplicates reply recipients and keeps comment contents out of notification metadata', async () => {
    const root = await request(app).post(taskPath('/comments')).set(auth(2)).send({ body: 'Secret discussion content' }).expect(201);
    const before = (await inbox(2).expect(200)).body.total;
    await request(app).post(taskPath('/comments')).set(auth()).send({ body: 'Private reply content', parentId: root.body.id }).expect(201);
    const notices = (await inbox(2).expect(200)).body;
    expect(notices.total).toBe(before + 1);
    expect(notices.items[0].type).toBe('COMMENT_REPLIED');
    expect(JSON.stringify(notices)).not.toContain('Private reply content');
  });
  it('supports unread filters, idempotent/concurrent reads, bulk reading, and recipient isolation', async () => {
    await request(app).get('/api/v1/notifications').expect(401);
    const notice = (await inbox().expect(200)).body.items[0];
    await request(app).patch(`/api/v1/notifications/${notice.id}/read`).set(auth(2)).expect(404);
    const reads = await Promise.all([1, 2].map(() => request(app).patch(`/api/v1/notifications/${notice.id}/read`).set(auth(1)).expect(200)));
    expect(reads[0].body.readAt).toBe(reads[1].body.readAt);
    expect((await inbox(1, '?unread=false').expect(200)).body.total).toBe(1);
    await request(app).patch('/api/v1/notifications/read-all').set(auth(1)).send({ projectId }).expect(200);
    expect((await request(app).get('/api/v1/notifications/unread-count').set(auth(1)).expect(200)).body.unreadCount).toBe(0);
    expect((await inbox(1, '?unread=true').expect(200)).body.total).toBe(0);
    expect((await request(app).patch('/api/v1/notifications/read-all').set(auth(1)).expect(200)).body.updatedCount).toBe(0);
    expect((await inbox(3).expect(200)).body.total).toBe(0);
    await inbox(1, '?limit=101').expect(400);
    await inbox(1, '?unread=yes').expect(400);
    await request(app).patch('/api/v1/notifications/no/read').set(auth(1)).expect(400);
    await request(app).patch('/api/v1/notifications/read-all').set(auth(1)).send({ userId: users[2].id }).expect(400);
  });
  it('rolls task and activity changes back if notification persistence fails', async () => {
    const before = await db.activity.count({ where: { projectId } });
    vi.spyOn(writes, 'notifyMembers').mockRejectedValueOnce(new Error('Injected notification persistence failure'));
    await request(app).patch(taskPath()).set(auth()).send({ title: 'Rolled back' }).expect(500);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).title).toBe('Notice task');
    expect(await db.activity.count({ where: { projectId } })).toBe(before);
  });
  it('notifies new recipients on member removal and hides notices from departed members', async () => {
    const notice = (await inbox(2).expect(200)).body.items[0];
    await request(app).delete(`/api/v1/projects/${projectId}/members/${users[2].id}`).set(auth()).expect(200);
    expect((await inbox(2).expect(200)).body.total).toBe(0);
    await request(app).patch(`/api/v1/notifications/${notice.id}/read`).set(auth(2)).expect(404);
    expect((await inbox(1).expect(200)).body.items[0]).toMatchObject({ type: 'TASK_ASSIGNED', metadata: { reason: 'MEMBER_REMOVAL' } });
  });
  it('handles task/project lifecycle visibility and cascades notices on purge', async () => {
    await request(app).delete(taskPath()).set(auth()).expect(204);
    const deleted = (await inbox(1).expect(200)).body;
    expect(deleted.items.every((notice: { type: string }) => notice.type === 'TASK_DELETED')).toBe(true);
    await request(app).post(taskPath('/restore')).set(auth()).expect(200);
    expect((await inbox(1).expect(200)).body.items[0].type).toBe('TASK_RESTORED');
    await request(app).delete(`/api/v1/projects/${projectId}`).set(auth()).expect(204);
    expect((await inbox(1).expect(200)).body.total).toBe(0);
    await request(app).post(`/api/v1/projects/${projectId}/restore`).set(auth()).expect(200);
    expect((await inbox(1).expect(200)).body.total).toBeGreaterThan(0);
    await request(app).delete(taskPath()).set(auth()).expect(204);
    await request(app).delete(taskPath('/permanent')).set(auth()).expect(204);
    expect(await db.notification.count({ where: { taskId } })).toBe(0);
  });
});
