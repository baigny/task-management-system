import { randomUUID } from 'node:crypto';
import { mkdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { db } from '../../src/db.js';
import { config } from '../../src/config.js';
import * as activity from '../../src/activity.js';
import { cleanupFiles } from '../../src/attachments/cleanup.js';
import { storagePath } from '../../src/attachments/storage.js';
import * as attachments from '../../src/attachments/service.js';
import { accounts, cleanup } from './helpers.js';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 255, 217]);
let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
let taskId: string;
let otherTaskId: string;
let initialJobs: Set<string>;
const ids: string[] = [];
const ownKeys = new Set<string>();
/** Bind requests to this suite's owner, members, or outsider. */
const auth = (index = 0) => ({ Authorization: `Bearer ${users[index].token}` });
/** Build an attachment path for the chosen fixture task. */
const path = (suffix = '', task = taskId) => `/api/v1/projects/${projectId}/tasks/${task}/attachments${suffix}`;

describe('protected task attachments', () => {
  beforeAll(async () => {
    initialJobs = new Set((await db.fileCleanup.findMany()).map(job => job.storageKey));
    users = await accounts(4);
    projectId = (await request(app).post('/api/v1/projects').set(auth()).send({ name: 'Private files' }).expect(201)).body.id;
    await db.membership.createMany({ data: users.slice(1, 3).map(user => ({ projectId, userId: user.id })) });
    taskId = (await db.task.create({ data: { projectId, title: 'Files here' } })).id;
    otherTaskId = (await db.task.create({ data: { projectId, title: 'Different task' } })).id;
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => {
    const records = await db.attachment.findMany({ where: { task: { projectId } } });
    records.forEach(record => ownKeys.add(record.storageKey));
    (await db.fileCleanup.findMany()).filter(job => !initialJobs.has(job.storageKey)).forEach(job => ownKeys.add(job.storageKey));
    for (const key of ownKeys) await unlink(storagePath(key)).catch(() => {});
    await db.fileCleanup.deleteMany({ where: { storageKey: { in: [...ownKeys] } } });
    await cleanup(users.map(user => user.id));
  });

  it('checks authentication and membership before reserving upload storage', async () => {
    const before = await db.fileCleanup.count();
    await request(app).post(path()).attach('file', pdf, { filename: 'design.pdf', contentType: 'application/pdf' }).expect(401);
    await request(app).post(path()).set(auth(3)).attach('file', pdf, { filename: 'design.pdf', contentType: 'application/pdf' }).expect(404);
    expect(await db.fileCleanup.count()).toBe(before);
  });
  it('accepts only the four requested extensions and matching media types/signatures', async () => {
    for (const [name, type, bytes] of [
      ['notes.txt', 'text/plain', Buffer.from('text')],
      ['image.gif', 'image/gif', Buffer.from('GIF89a')],
      ['wrong.pdf', 'image/png', png],
      ['fake.png', 'image/png', Buffer.from('not a PNG')],
      ['fake.jpg', 'image/jpeg', pdf],
    ] as const) {
      await request(app).post(path()).set(auth(1)).attach('file', bytes, { filename: name, contentType: type }).expect(415);
    }
    for (const [name, type, bytes] of [
      ['design.pdf', 'application/pdf', pdf], ['diagram.PNG', 'image/png', png],
      ['photo.jpg', 'image/jpeg', jpeg], ['photo.jpeg', 'image/jpeg', jpeg],
    ] as const) {
      const result = await request(app).post(path()).set(auth(1)).attach('file', bytes, { filename: name, contentType: type }).expect(201);
      ids.push(result.body.id);
      expect(result.body).toMatchObject({ originalName: name, mimeType: type, size: bytes.length, uploaderId: users[1].id });
      expect(result.body).not.toHaveProperty('storageKey');
      expect(result.body).not.toHaveProperty('path');
      const record = await db.attachment.findUniqueOrThrow({ where: { id: result.body.id } });
      ownKeys.add(record.storageKey);
      expect(record.storageKey).not.toBe(name);
      expect(await db.fileCleanup.findUnique({ where: { storageKey: record.storageKey } })).toBeNull();
    }
  });
  it('rejects oversized, empty, missing, extra-field, and multiple-file uploads', async () => {
    const before = await db.attachment.count({ where: { taskId } });
    await request(app).post(path()).set(auth(1)).attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'large.pdf', contentType: 'application/pdf' }).expect(413);
    await request(app).post(path()).set(auth(1)).attach('file', Buffer.alloc(0), { filename: 'empty.pdf', contentType: 'application/pdf' }).expect(400);
    await request(app).post(path()).set(auth(1)).expect(400);
    await request(app).post(path()).set(auth(1)).field('title', 'Unexpected').attach('file', pdf, { filename: 'extra.pdf', contentType: 'application/pdf' }).expect(400);
    await request(app).post(path()).set(auth(1)).attach('file', pdf, { filename: 'one.pdf', contentType: 'application/pdf' }).attach('file', pdf, { filename: 'two.pdf', contentType: 'application/pdf' }).expect(400);
    expect(await db.attachment.count({ where: { taskId } })).toBe(before);
  });
  it('pages metadata and protects downloads, public paths, and cross-task IDs', async () => {
    const list = await request(app).get(path('?limit=2')).set(auth(2)).expect(200);
    expect(list.body).toMatchObject({ total: 4, page: 1, limit: 2 });
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items[0]).not.toHaveProperty('storageKey');
    await request(app).get(path('?limit=101')).set(auth()).expect(400);
    await request(app).get(path(`/${ids[0]}/download`)).expect(401);
    await request(app).get(path(`/${ids[0]}/download`)).set(auth(3)).expect(404);
    await request(app).get(path(`/${ids[0]}/download`, otherTaskId)).set(auth()).expect(404);
    const result = await request(app).get(path(`/${ids[0]}/download`)).set(auth(2)).expect(200);
    expect(result.headers).toMatchObject({ 'content-type': 'application/pdf', 'content-length': String(pdf.length), 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
    expect(result.headers['content-disposition']).toMatch(/^attachment; filename="?design\.pdf"?$/);
    expect(result.body).toEqual(pdf);
    const record = await db.attachment.findUniqueOrThrow({ where: { id: ids[0] } });
    await request(app).get(`/uploads/${record.storageKey}`).expect(404);
  });
  it('accepts a file exactly at the size limit', async () => {
    const bytes = Buffer.alloc(10 * 1024 * 1024, 32);
    pdf.copy(bytes);
    const result = await request(app).post(path()).set(auth()).attach('file', bytes, { filename: 'limit.pdf', contentType: 'application/pdf' }).expect(201);
    const record = await db.attachment.findUniqueOrThrow({ where: { id: result.body.id } });
    ownKeys.add(record.storageKey);
    expect(result.body.size).toBe(bytes.length);
    await request(app).delete(path(`/${result.body.id}`)).set(auth()).expect(204);
  });
  it('rolls back metadata on activity failure and leaves rejected upload cleanup durable', async () => {
    const before = await db.attachment.count({ where: { taskId } });
    vi.spyOn(activity, 'recordActivity').mockRejectedValueOnce(new Error('Injected attachment activity failure'));
    await request(app).post(path()).set(auth(1)).attach('file', pdf, { filename: 'rollback.pdf', contentType: 'application/pdf' }).expect(500);
    expect(await db.attachment.count({ where: { taskId } })).toBe(before);
    expect(await db.fileCleanup.count({ where: { availableAt: { lte: new Date() } } })).toBeGreaterThan(0);
  });
  it('rechecks membership after receiving the file before committing it', async () => {
    const original = attachments.createAttachment;
    vi.spyOn(attachments, 'createAttachment').mockImplementationOnce(async (...args) => {
      await db.membership.delete({ where: { projectId_userId: { projectId, userId: users[2].id } } });
      return original(...args);
    });
    await request(app).post(path()).set(auth(2)).attach('file', pdf, { filename: 'revoked.pdf', contentType: 'application/pdf' }).expect(404);
    await request(app).get(path(`/${ids[0]}/download`)).set(auth(2)).expect(404);
  });
  it('permits uploader/owner deletion and rolls deletion back if activity fails', async () => {
    await request(app).delete(path(`/${ids[0]}`)).set(auth(3)).expect(404);
    // Restore a second member to exercise a valid member without uploader privileges.
    await db.membership.create({ data: { projectId, userId: users[2].id } });
    await request(app).delete(path(`/${ids[0]}`)).set(auth(2)).expect(403);
    vi.spyOn(activity, 'recordActivity').mockRejectedValueOnce(new Error('Injected attachment deletion failure'));
    await request(app).delete(path(`/${ids[0]}`)).set(auth()).expect(500);
    expect(await db.attachment.findUnique({ where: { id: ids[0] } })).not.toBeNull();
    const record = await db.attachment.findUniqueOrThrow({ where: { id: ids[2] } });
    await request(app).delete(path(`/${ids[2]}`)).set(auth(1)).expect(204);
    await request(app).delete(path(`/${ids[0]}`)).set(auth()).expect(204);
    expect(await db.fileCleanup.findUnique({ where: { storageKey: record.storageKey } })).not.toBeNull();
    await request(app).get(path(`/${ids[2]}/download`)).set(auth()).expect(404);
  });
  it('preserves files through soft deletion/restoration and returns 404 for missing physical files', async () => {
    const taskPath = `/api/v1/projects/${projectId}/tasks/${taskId}`;
    await request(app).delete(taskPath).set(auth(1)).expect(204);
    await request(app).get(path(`/${ids[1]}/download`)).set(auth()).expect(404);
    await request(app).post(`${taskPath}/restore`).set(auth()).expect(200);
    await request(app).get(path(`/${ids[1]}/download`)).set(auth()).expect(200);
    await request(app).delete(`/api/v1/projects/${projectId}`).set(auth()).expect(204);
    await request(app).get(path()).set(auth()).expect(404);
    await request(app).post(`/api/v1/projects/${projectId}/restore`).set(auth()).expect(200);
    const record = await db.attachment.findUniqueOrThrow({ where: { id: ids[1] } });
    await unlink(storagePath(record.storageKey));
    await request(app).get(path(`/${ids[1]}/download`)).set(auth()).expect(404);
  });
  it('queues child files during task purge and removes files only after committed deletion', async () => {
    const result = await request(app).post(path('', otherTaskId)).set(auth()).attach('file', pdf, { filename: 'child.pdf', contentType: 'application/pdf' }).expect(201);
    const record = await db.attachment.findUniqueOrThrow({ where: { id: result.body.id } });
    ownKeys.add(record.storageKey);
    const taskPath = `/api/v1/projects/${projectId}/tasks/${otherTaskId}`;
    await request(app).delete(taskPath).set(auth()).expect(204);
    vi.spyOn(activity, 'recordActivity').mockRejectedValueOnce(new Error('Injected purge failure'));
    await request(app).delete(`${taskPath}/permanent`).set(auth()).expect(500);
    expect(await db.fileCleanup.findUnique({ where: { storageKey: record.storageKey } })).toBeNull();
    expect(await stat(storagePath(record.storageKey))).toBeDefined();
    await request(app).delete(`${taskPath}/permanent`).set(auth()).expect(204);
    expect(await db.attachment.findUnique({ where: { id: record.id } })).toBeNull();
    expect(await stat(storagePath(record.storageKey))).toBeDefined();
    await cleanupFiles(vi.fn());
    await expect(stat(storagePath(record.storageKey))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('retries failed deletions and reclaims abandoned reservations after a restart', async () => {
    const key = randomUUID();
    ownKeys.add(key);
    await mkdir(config.UPLOAD_DIR, { recursive: true });
    await mkdir(storagePath(key));
    await db.fileCleanup.create({ data: { storageKey: key } });
    const failed = vi.fn();
    await cleanupFiles(failed);
    expect(failed).toHaveBeenCalled();
    expect((await db.fileCleanup.findUniqueOrThrow({ where: { storageKey: key } })).availableAt.getTime()).toBeGreaterThan(Date.now());
    await rmdir(storagePath(key));
    await writeFile(storagePath(key), pdf);
    await cleanupFiles(vi.fn(), new Date(Date.now() + 61_000));
    await expect(stat(storagePath(key))).rejects.toMatchObject({ code: 'ENOENT' });
    const abandoned = randomUUID();
    ownKeys.add(abandoned);
    await writeFile(storagePath(abandoned), pdf);
    const later = new Date(Date.now() + 60 * 60 * 1000);
    await db.fileCleanup.create({ data: { storageKey: abandoned, availableAt: later } });
    await cleanupFiles(vi.fn());
    expect(await stat(storagePath(abandoned))).toBeDefined();
    await cleanupFiles(vi.fn(), later);
    await expect(stat(storagePath(abandoned))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('releases database locks during deletion and fences expired workers', async () => {
    const key = randomUUID();
    ownKeys.add(key);
    const now = new Date();
    await db.fileCleanup.create({ data: { storageKey: key, availableAt: now } });
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const deleting = new Promise<void>(resolve => { started = resolve; });
    const worker = cleanupFiles(vi.fn(), now, async () => { started(); await blocked; });
    try {
      await deleting;
      // A second transaction can acquire this row while the first worker is still in filesystem I/O.
      const future = new Date(now.getTime() + 120_000);
      await db.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
        await tx.fileCleanup.update({ where: { storageKey: key }, data: { availableAt: future } });
      });
      expect(await cleanupFiles(vi.fn(), now)).toBe(0);
      release();
      await worker;
      expect((await db.fileCleanup.findUniqueOrThrow({ where: { storageKey: key } })).availableAt).toEqual(future);
    } finally { release(); await worker; }
    await cleanupFiles(vi.fn(), new Date(now.getTime() + 120_000));
    expect(await db.fileCleanup.findUnique({ where: { storageKey: key } })).toBeNull();
  });
  it('queues project files before cascade deletion and drains bounded batches', async () => {
    const record = await db.attachment.findUniqueOrThrow({ where: { id: ids[3] } });
    await request(app).delete(`/api/v1/projects/${projectId}`).set(auth()).expect(204);
    await request(app).delete(`/api/v1/projects/${projectId}/permanent`).set(auth()).expect(204);
    expect(await db.attachment.count({ where: { taskId } })).toBe(0);
    expect(await db.fileCleanup.findUnique({ where: { storageKey: record.storageKey } })).not.toBeNull();
    await cleanupFiles(vi.fn());
    await expect(stat(storagePath(record.storageKey))).rejects.toMatchObject({ code: 'ENOENT' });
    const keys = Array.from({ length: 101 }, () => randomUUID());
    keys.forEach(key => ownKeys.add(key));
    await db.fileCleanup.createMany({ data: keys.map(storageKey => ({ storageKey })) });
    expect(await cleanupFiles(vi.fn())).toBe(100);
    expect(await db.fileCleanup.count({ where: { storageKey: { in: keys } } })).toBe(1);
    expect(await cleanupFiles(vi.fn())).toBe(1);
  });
});
