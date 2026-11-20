import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db.js';
import { PrismaClient } from '@prisma/client';
import { testDatabaseUrl } from '../../scripts/test-database.js';
import { authorizeProject, inProject } from '../../src/access.js';
import { accounts, cleanup } from './helpers.js';

let users: Awaited<ReturnType<typeof accounts>>;
let projectId: string;
// A separate client makes locking tests independent of the default pool size.
const concurrentDb = new PrismaClient({ datasourceUrl: testDatabaseUrl(process.env.TEST_DATABASE_URL) });

describe('project access locking', () => {
  beforeAll(async () => {
    users = await accounts(1);
    const project = await db.project.create({ data: { name: 'Concurrent reads', ownerId: users[0].id, memberships: { create: { userId: users[0].id } } } });
    projectId = project.id;
  });
  afterAll(async () => { await concurrentDb.$disconnect(); await cleanup(users.map(user => user.id)); });
  it('allows a second authorized reader while the first reader still holds its lock', async () => {
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const first = inProject(projectId, users[0].id, async () => { acquired(); await held; }, { mode: 'read' });
    await ready;
    try {
      await concurrentDb.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
        expect((await authorizeProject(tx, projectId, users[0].id, { mode: 'read' })).id).toBe(projectId);
      });
    } finally { release(); await first; }
  });
  it('blocks mutations until an authorized reader completes', async () => {
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const reader = inProject(projectId, users[0].id, async () => { acquired(); await held; }, { mode: 'read' });
    await ready;
    try {
      await expect(concurrentDb.$transaction(async tx => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '200ms'`;
        await authorizeProject(tx, projectId, users[0].id);
      })).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    } finally { release(); await reader; }
    await inProject(projectId, users[0].id, async tx => { await tx.project.update({ where: { id: projectId }, data: { name: 'Changed after read' } }); });
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).name).toBe('Changed after read');
  });
});
