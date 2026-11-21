import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import * as provider from '../../src/ai/provider.js';
import { aiLimiter } from '../../src/ai/routes.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
const path = '/api/v1/ai/summaries';
/** Authenticate actual owner, member, and outsider sessions. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Keep lifecycle and concurrent-change scenarios independent. */
async function fixture() {
  const project = await db.project.create({ data: { name: 'Summary project', ownerId: users[0].id, memberships: { create: users.slice(0, 2).map(user => ({ userId: user.id })) } } });
  return db.task.create({ data: { projectId: project.id, title: 'Export tasks', description: 'Export completed tasks to CSV.', status: 'IN_PROGRESS', assigneeId: users[1].id, dueDate: new Date('2027-01-31T12:00:00Z') } });
}
beforeAll(async () => { users = await accounts(3); });
afterEach(() => { vi.restoreAllMocks(); users.forEach(user => { aiLimiter.resetKey(user.id); }); });
afterAll(async () => { await cleanup(users.map(user => user.id)); });

describe('authorized task summaries', () => {
  it('validates authentication and identifiers before calling Gemini', async () => {
    const generate = vi.spyOn(provider, 'generateSuggestion').mockRejectedValue(new Error('Unexpected provider call'));
    await request(app).post(path).send({}).expect(401);
    for (const body of [{}, { projectId: 'invalid', taskId: 'invalid' }, { projectId: users[0].id, taskId: users[0].id, description: 'Caller override' }]) {
      await request(app).post(path).set(auth()).send(body).expect(400);
    }
    expect(generate).not.toHaveBeenCalled();
  });
  it('conceals inaccessible, cross-project, and deleted tasks before provider access', async () => {
    const task = await fixture();
    const other = await fixture();
    const generate = vi.spyOn(provider, 'generateSuggestion').mockRejectedValue(new Error('Unexpected provider call'));
    const input = { projectId: task.projectId, taskId: task.id };
    await request(app).post(path).set(auth(2)).send(input).expect(404);
    await request(app).post(path).set(auth()).send({ ...input, taskId: other.id }).expect(404);
    await db.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
    await request(app).post(path).set(auth()).send(input).expect(404);
    await db.project.update({ where: { id: other.projectId }, data: { deletedAt: new Date() } });
    await request(app).post(path).set(auth()).send({ projectId: other.projectId, taskId: other.id }).expect(404);
    expect(generate).not.toHaveBeenCalled();
  });
  it('sends only task content and returns a source timestamp without persisting changes', async () => {
    const task = await fixture();
    const generate = vi.spyOn(provider, 'generateSuggestion').mockResolvedValue({ text: 'CSV export is in progress.', model: 'mock-gemini' });
    const response = await request(app).post(path).set(auth(1)).send({ projectId: task.projectId, taskId: task.id }).expect(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ summary: 'CSV export is in progress.', model: 'mock-gemini', taskId: task.id, sourceUpdatedAt: task.updatedAt.toISOString() });
    expect(JSON.parse(generate.mock.calls[0][1])).toEqual({ title: task.title, description: task.description, status: task.status, dueDate: task.dueDate?.toISOString() });
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toEqual(task);
    expect(await db.activity.count({ where: { projectId: task.projectId } })).toBe(0);
    expect(await db.notification.count({ where: { projectId: task.projectId } })).toBe(0);
  });
  it.each(['membership', 'task', 'project'] as const)('rechecks %s access after generation without holding database locks', async change => {
    const task = await fixture();
    vi.spyOn(provider, 'generateSuggestion').mockImplementation(async () => {
      if (change === 'membership') await db.membership.delete({ where: { projectId_userId: { projectId: task.projectId, userId: users[1].id } } });
      if (change === 'task') await db.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
      if (change === 'project') await db.project.update({ where: { id: task.projectId }, data: { deletedAt: new Date() } });
      return { text: 'Must not be disclosed', model: 'mock-gemini' };
    });
    const response = await request(app).post(path).set(auth(1)).send({ projectId: task.projectId, taskId: task.id }).expect(404);
    expect(JSON.stringify(response.body)).not.toContain('Must not be disclosed');
  });
  it('rejects a stale source and oversized summary output', async () => {
    const task = await fixture();
    const generate = vi.spyOn(provider, 'generateSuggestion').mockImplementationOnce(async () => {
      await db.task.update({ where: { id: task.id }, data: { title: 'Updated goal', updatedAt: new Date(task.updatedAt.getTime() + 1000) } });
      return { text: 'Old summary', model: 'mock-gemini' };
    });
    const response = await request(app).post(path).set(auth()).send({ projectId: task.projectId, taskId: task.id }).expect(409);
    expect(response.body.error.code).toBe('TASK_CHANGED');
    generate.mockResolvedValue({ text: 'x'.repeat(4001), model: 'mock-gemini' });
    await request(app).post(path).set(auth()).send({ projectId: task.projectId, taskId: task.id }).expect(502);
  });
  it('shares one account quota with description generation', async () => {
    const task = await fixture();
    vi.spyOn(provider, 'generateSuggestion').mockResolvedValue({ text: 'Suggestion', model: 'mock-gemini' });
    for (let index = 0; index < 5; index++) {
      await request(app).post(path).set(auth()).send({ projectId: task.projectId, taskId: task.id }).expect(200);
      await request(app).post('/api/v1/ai/descriptions').set(auth()).send({ input: 'idea' }).expect(200);
    }
    await request(app).post(path).set(auth()).send({ projectId: task.projectId, taskId: task.id }).expect(429);
  });
});
