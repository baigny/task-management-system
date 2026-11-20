import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { config } from '../../src/config.js';
import { createSession } from '../../src/auth/service.js';
import { resetTokenHash } from '../../src/auth/recovery.js';
import { sessionClaims } from '../../src/auth/validation.js';
import { closeNotificationStreams } from '../../src/notifications/stream.js';
import { notifyMembers } from '../../src/notifications/write.js';
import { accounts, cleanup } from './helpers.js';

let server: Server;
let baseUrl: string;
let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
let taskId: string;
const controllers = new Set<AbortController>();
/** Authenticate fixture mutations while the stream uses a real HTTP socket. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Read the recipient's current cursor without changing read/unread state. */
async function latestId() { return (await db.notification.findFirst({ where: { userId: users[1].id }, orderBy: { id: 'desc' } }))?.id ?? 0; }

/** Connect a real SSE client with bounded frame/close waits to prevent hanging tests. */
async function connect(after: number, token = users[1].token) {
  const controller = new AbortController();
  controllers.add(controller);
  const response = await fetch(`${baseUrl}/api/v1/notifications/stream`, { headers: { Authorization: `Bearer ${token}`, 'Last-Event-ID': String(after) }, signal: controller.signal });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  /** Await a matching complete frame while preserving subsequent buffered frames. */
  async function frame(matches: (value: string) => boolean, timeout = 6000) {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('SSE frame deadline exceeded')); }, timeout); });
    try {
      return await Promise.race([deadline, (async () => {
        while (true) {
          const boundary = buffer.indexOf('\n\n');
          if (boundary >= 0) {
            const value = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (matches(value)) return value;
          } else {
            const chunk = await reader.read();
            if (chunk.done) throw new Error('SSE stream ended before expected frame');
            buffer += decoder.decode(chunk.value, { stream: true });
          }
        }
      })()]);
    } finally { clearTimeout(timer!); }
  }
  /** Drain until EOF to assert revocation, expiry, or graceful shutdown behavior. */
  async function ended(timeout = 6000) {
    let timer: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('SSE close deadline exceeded')); }, timeout); }),
        (async () => { while (!(await reader.read()).done) { /* Drain frames until the server closes. */ } })(),
      ]);
    } finally { clearTimeout(timer!); }
  }
  return { frame, ended, abort: () => { controller.abort(); } };
}

describe('authenticated notification SSE', () => {
  beforeAll(async () => {
    users = await accounts(3);
    projectId = (await request(app).post('/api/v1/projects').set(auth()).send({ name: 'SSE' }).expect(201)).body.id;
    await db.membership.createMany({ data: users.slice(1).map(user => ({ projectId, userId: user.id })) });
    taskId = (await request(app).post(`/api/v1/projects/${projectId}/tasks`).set(auth()).send({ title: 'Stream task', assigneeId: users[1].id }).expect(201)).body.id;
    await request(app).patch(`/api/v1/projects/${projectId}/tasks/${taskId}`).set(auth()).send({ status: 'IN_PROGRESS' }).expect(200);
    server = await new Promise<Server>(resolve => { const instance = app.listen(0, '127.0.0.1', () => { resolve(instance); }); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterEach(() => { vi.restoreAllMocks(); controllers.forEach(controller => { controller.abort(); }); controllers.clear(); closeNotificationStreams(); });
  afterAll(async () => { closeNotificationStreams(); server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); await cleanup(users.map(user => user.id)); });

  it('requires bearer authentication and validates replay cursors without URL tokens', async () => {
    expect((await fetch(`${baseUrl}/api/v1/notifications/stream`)).status).toBe(401);
    for (const cursor of ['-1', 'abc', '2147483648']) {
      const response = await fetch(`${baseUrl}/api/v1/notifications/stream`, { headers: { ...auth(1), 'Last-Event-ID': cursor } });
      expect(response.status).toBe(400);
    }
    expect((await fetch(`${baseUrl}/api/v1/notifications/stream?token=not-a-token`, { headers: auth(1) })).status).toBe(400);
  });
  it('replays only later persisted IDs, delivers new commits, and leaves notices unread', async () => {
    const notices = await db.notification.findMany({ where: { userId: users[1].id }, orderBy: { id: 'asc' } });
    const first = await connect(notices[0].id);
    const replay = await first.frame(value => value.includes('event: notification'));
    expect(replay).toContain(`id: ${notices[1].id}\n`);
    first.abort();
    const second = await connect(notices[1].id);
    await request(app).patch(`/api/v1/projects/${projectId}/tasks/${taskId}`).set(auth()).send({ description: 'Committed update' }).expect(200);
    const live = await second.frame(value => value.includes('event: notification'));
    expect(live).toContain('TASK_UPDATED');
    expect(live).toContain('updated your task');
    expect(await db.notification.count({ where: { userId: users[1].id, readAt: { not: null } } })).toBe(0);
  });
  it('replays a backlog across multiple 100-record batches without gaps', async () => {
    const cursor = await latestId();
    await db.notification.createMany({ data: Array.from({ length: 105 }, () => ({ userId: users[1].id, actorId: users[0].id, projectId, taskId, type: 'TASK_UPDATED' as const })) });
    const expected = await db.notification.findMany({ where: { userId: users[1].id, id: { gt: cursor } }, orderBy: { id: 'asc' }, select: { id: true } });
    const client = await connect(cursor);
    const received: number[] = [];
    for (let index = 0; index < 105; index++) {
      const frame = await client.frame(value => value.includes('event: notification'));
      received.push(Number(/^id: (\d+)/.exec(frame)![1]));
    }
    expect(received).toEqual(expected.map(notice => notice.id));
  });
  it('keeps heartbeat traffic alive but filters notices after membership removal', async () => {
    const client = await connect(await latestId());
    await request(app).delete(`/api/v1/projects/${projectId}/members/${users[1].id}`).set(auth()).expect(200);
    await db.notification.create({ data: { userId: users[1].id, actorId: users[0].id, projectId, taskId, type: 'TASK_UPDATED' } });
    const frame = await client.frame(value => value.includes('event: notification') || value.startsWith(': heartbeat'), 18000);
    expect(frame).toBe(': heartbeat');
    await db.membership.create({ data: { projectId, userId: users[1].id } });
  }, 20000);
  it('closes one device on logout and all devices on logout-all', async () => {
    const extra = await createSession(users[1]);
    const first = await connect(await latestId());
    const second = await connect(await latestId(), extra.token);
    await request(app).post('/api/v1/auth/logout').set(auth(1)).expect(204);
    await first.ended();
    await request(app).post('/api/v1/auth/logout-all').set({ Authorization: `Bearer ${extra.token}` }).expect(204);
    await second.ended();
    users[1] = { ...users[1], ...await createSession(users[1]) };
  });
  it('disconnects at JWT expiry and detects sessions revoked directly in PostgreSQL', async () => {
    const claims = sessionClaims.parse(jwt.decode(users[1].token));
    const token = jwt.sign({ sub: users[1].id, sid: claims.sid }, config.JWT_SECRET, { algorithm: 'HS256', issuer: 'task-management', audience: 'task-api', expiresIn: 3 });
    const short = await connect(await latestId(), token);
    await short.ended(5000);
    const extra = await createSession(users[1]);
    const external = await connect(await latestId(), extra.token);
    await db.session.delete({ where: { id: sessionClaims.parse(jwt.decode(extra.token)).sid } });
    await external.ended(5000);
  }, 12000);
  it('closes streams after committed password reset and password change', async () => {
    const token = randomBytes(32).toString('hex');
    await db.passwordReset.create({ data: { userId: users[1].id, tokenHash: resetTokenHash(token), expiresAt: new Date(Date.now() + 60_000) } });
    const resetStream = await connect(await latestId());
    await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'reset-stream-password-123', confirmPassword: 'reset-stream-password-123' }).expect(204);
    await resetStream.ended();
    users[1] = { ...users[1], ...await createSession(users[1]) };
    const changeStream = await connect(await latestId());
    await request(app).post('/api/v1/auth/change-password').set(auth(1)).send({ currentPassword: 'reset-stream-password-123', password: 'changed-stream-password-123', confirmPassword: 'changed-stream-password-123' }).expect(204);
    await changeStream.ended();
    users[1] = { ...users[1], ...await createSession(users[1]) };
  }, 10000);
  it('closes with a generic retryable event when a database recheck fails', async () => {
    const client = await connect(await latestId());
    await client.frame(value => value.startsWith(': connected'));
    vi.spyOn(db.session, 'findUnique').mockRejectedValueOnce(new Error('Injected private database detail'));
    const error = await client.frame(value => value.includes('event: stream-error'));
    expect(error).toContain('STREAM_UNAVAILABLE');
    expect(error).not.toContain('private database');
    await client.ended();
  });
  it('limits per-account connections and closes active streams on graceful shutdown', async () => {
    const clients = [];
    for (let index = 0; index < 5; index++) clients.push(await connect(await latestId()));
    const limited = await fetch(`${baseUrl}/api/v1/notifications/stream`, { headers: auth(1) });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('3');
    closeNotificationStreams();
    await Promise.all(clients.map(client => client.ended()));
  });
  it('holds notification ID ordering until commit so a replay cursor cannot skip a late commit', async () => {
    let release!: () => void;
    let ready!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const inserted = new Promise<void>(resolve => { ready = resolve; });
    const first = db.$transaction(async tx => {
      await notifyMembers(tx, projectId, users[0].id, [{ taskId, userId: users[1].id, type: 'TASK_UPDATED' }]);
      ready();
      await held;
    });
    try {
      await inserted;
      const [lock] = await db.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(1700, 1) AS acquired`;
      expect(lock.acquired).toBe(false);
    } finally { release(); await first; }
    const before = await latestId();
    await db.$transaction(tx => notifyMembers(tx, projectId, users[0].id, [{ taskId, userId: users[1].id, type: 'TASK_UPDATED' }]));
    expect(await latestId()).toBeGreaterThan(before);
  });
});
