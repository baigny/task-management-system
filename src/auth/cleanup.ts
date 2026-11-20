import { db } from '../db.js';

const BATCH_SIZE = 500;
const INTERVAL_MS = 15 * 60 * 1000;

/** Delete bounded expired batches without waiting on records used by active requests. */
export async function cleanupExpiredAuth(now = new Date()) {
  const throttleCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sessions = await db.$executeRaw`
    WITH expired AS (
      SELECT id FROM "Session" WHERE "expiresAt" <= ${now}
      ORDER BY "expiresAt", id LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
    ) DELETE FROM "Session" WHERE id IN (SELECT id FROM expired)`;
  const resets = await db.$executeRaw`
    WITH expired AS (
      SELECT id FROM "PasswordReset" WHERE "expiresAt" <= ${now}
      ORDER BY "expiresAt", id LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
    ) DELETE FROM "PasswordReset" WHERE id IN (SELECT id FROM expired)`;
  const attempts = await db.$executeRaw`
    WITH stale AS (
      SELECT key FROM "AuthAttempt" WHERE "windowStartedAt" <= ${throttleCutoff}
      ORDER BY "windowStartedAt", key LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
    ) DELETE FROM "AuthAttempt" WHERE key IN (SELECT key FROM stale)`;
  return { sessions, resets, attempts };
}

/** Run one cleanup at a time; stop scheduling and drain in-flight work on shutdown. */
export function startAuthCleanup(onFailure: () => void) {
  let pending: Promise<void> | undefined;
  let stopped = false;
  /** Skip overlapping ticks and report failures without exposing database details. */
  function tick() {
    if (pending || stopped) return;
    pending = cleanupExpiredAuth().then(() => {}, () => { onFailure(); }).finally(() => { pending = undefined; });
  }
  const timer = setInterval(tick, INTERVAL_MS);
  timer.unref();
  tick();
  /** Prevent new runs before awaiting the current bounded batch. */
  return async function stop() {
    stopped = true;
    clearInterval(timer);
    await pending;
  };
}
