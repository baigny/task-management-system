import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db.js';
import { cleanupExpiredAuth } from '../../src/auth/cleanup.js';
import { accounts, cleanup } from './helpers.js';

const now = new Date('2001-01-02T00:00:00Z');
const expired = new Date('2000-01-01T00:00:00Z');
const future = new Date('2002-01-01T00:00:00Z');
const prefix = randomUUID();
let users: Awaited<ReturnType<typeof accounts>>;

describe('bounded authentication housekeeping', () => {
  beforeAll(async () => {
    users = await accounts(1);
    const userId = users[0].id;
    await db.session.createMany({ data: Array.from({ length: 501 }, () => ({ userId, expiresAt: expired })) });
    await db.passwordReset.createMany({ data: Array.from({ length: 501 }, () => ({ userId, tokenHash: randomUUID(), expiresAt: expired })) });
    await db.authAttempt.createMany({ data: Array.from({ length: 501 }, (_, index) => ({ key: `${prefix}-${index}`, windowStartedAt: expired })) });
    await db.passwordReset.create({ data: { userId, tokenHash: `${prefix}-valid`, expiresAt: future } });
    // An inactive 15-minute window is retained until the longer housekeeping cutoff.
    await db.authAttempt.create({ data: { key: `${prefix}-recent`, count: 5, windowStartedAt: new Date(now.getTime() - 60 * 60 * 1000) } });
  });
  afterAll(async () => {
    await db.authAttempt.deleteMany({ where: { key: { startsWith: prefix } } });
    await cleanup(users.map(user => user.id));
  });
  it('caps every table at 500 deletions and preserves valid records', async () => {
    expect(await cleanupExpiredAuth(now)).toEqual({ sessions: 500, resets: 500, attempts: 500 });
    expect(await db.session.count({ where: { userId: users[0].id, expiresAt: expired } })).toBe(1);
    expect(await db.passwordReset.count({ where: { tokenHash: `${prefix}-valid` } })).toBe(1);
    expect(await db.authAttempt.findUnique({ where: { key: `${prefix}-recent` } })).toMatchObject({ count: 5 });
    expect(await db.session.count({ where: { userId: users[0].id, expiresAt: { gt: now } } })).toBe(1);
  });
  it('drains the remaining backlog and is safe to repeat', async () => {
    expect(await cleanupExpiredAuth(now)).toEqual({ sessions: 1, resets: 1, attempts: 1 });
    expect(await cleanupExpiredAuth(now)).toEqual({ sessions: 0, resets: 0, attempts: 0 });
  });
  it('skips records locked by another request and retries them later', async () => {
    const session = await db.session.create({ data: { userId: users[0].id, expiresAt: expired } });
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${session.id} FOR UPDATE`;
      expect(await cleanupExpiredAuth(now)).toEqual({ sessions: 0, resets: 0, attempts: 0 });
      expect(await tx.session.findUnique({ where: { id: session.id } })).not.toBeNull();
    });
    expect(await cleanupExpiredAuth(now)).toEqual({ sessions: 1, resets: 0, attempts: 0 });
  });
});
