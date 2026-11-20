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

/** Remove up to 100 due files; failures retain durable jobs for a later retry. */
export function cleanupFiles(onFailure: () => void, now = new Date()) {
  return db.$transaction(async tx => {
    const jobs = await tx.$queryRaw<{ storageKey: string }[]>`
      SELECT "storageKey" FROM "FileCleanup" WHERE "availableAt" <= ${now}
      ORDER BY "availableAt", "storageKey" LIMIT 100 FOR UPDATE SKIP LOCKED`;
    for (const job of jobs) {
      try {
        try { await unlink(storagePath(job.storageKey)); }
        catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
        await tx.fileCleanup.delete({ where: { storageKey: job.storageKey } });
      } catch {
        await tx.fileCleanup.update({ where: { storageKey: job.storageKey }, data: { availableAt: new Date(now.getTime() + 60_000) } });
        onFailure();
      }
    }
    return jobs.length;
  }, { timeout: 10_000 });
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
