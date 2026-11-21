import { unlink } from 'node:fs/promises';
import { db } from '../db.js';
import type { Transaction } from '../access.js';
import { storagePath } from './storage.js';

/** Queue all child files before their database rows disappear in the same purge transaction. */
export async function queueTaskFiles(tx: Transaction, projectId: string, taskId?: string) {
  if (taskId) {
    await tx.$executeRaw`INSERT INTO "FileCleanup" ("storageKey", "availableAt")
      SELECT "storageKey", CURRENT_TIMESTAMP FROM "Attachment" WHERE "taskId" = ${taskId}
      ON CONFLICT ("storageKey") DO NOTHING`;
  } else {
    await tx.$executeRaw`INSERT INTO "FileCleanup" ("storageKey", "availableAt")
      SELECT a."storageKey", CURRENT_TIMESTAMP FROM "Attachment" a JOIN "Task" t ON t.id = a."taskId"
      WHERE t."projectId" = ${projectId} ON CONFLICT ("storageKey") DO NOTHING`;
  }
}

/** Lease at most 100 jobs, release database locks, then perform idempotent filesystem deletion. */
export async function cleanupFiles(onFailure: () => void, now = new Date(), removeFile = unlink) {
  const leaseUntil = new Date(now.getTime() + 60_000);
  const jobs = await db.$queryRaw<{ storageKey: string }[]>`
    WITH due AS (
      SELECT "storageKey" FROM "FileCleanup" WHERE "availableAt" <= ${now}
      ORDER BY "availableAt", "storageKey" LIMIT 100 FOR UPDATE SKIP LOCKED
    ) UPDATE "FileCleanup" SET "availableAt" = ${leaseUntil}
      WHERE "storageKey" IN (SELECT "storageKey" FROM due) RETURNING "storageKey"`;
  for (const job of jobs) {
    try {
      try { await removeFile(storagePath(job.storageKey)); }
      catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
      // The lease timestamp fences stale workers after another cleanup run has reclaimed a job.
      await db.fileCleanup.deleteMany({ where: { storageKey: job.storageKey, availableAt: leaseUntil } });
    } catch { onFailure(); } // The durable lease becomes retryable even if this process crashes.
  }
  return jobs.length;
}

/** Retry queued deletion and abandoned uploads every minute without overlapping runs. */
export function startFileCleanup(onFailure: () => void) {
  let pending: Promise<void> | undefined;
  let stopped = false;
  /** Start a bounded run only when the previous run has settled. */
  function tick() {
    if (pending || stopped) return;
    pending = cleanupFiles(onFailure).then(() => {}, () => { onFailure(); }).finally(() => { pending = undefined; });
  }
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  /** Stop scheduling before draining the current file cleanup transaction. */
  return async function stop() { stopped = true; clearInterval(timer); await pending; };
}
