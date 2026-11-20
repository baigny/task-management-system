import type { NotificationType, Prisma } from '@prisma/client';
import type { Transaction } from '../access.js';

type Notice = { userId: string | null | undefined; taskId: string; type: NotificationType; metadata?: Prisma.InputJsonValue };

/** Persist one notice per recipient/task, excluding actors and departed members, in bounded batches. */
export async function notifyMembers(tx: Transaction, projectId: string, actorId: string, notices: Notice[]) {
  const unique = new Map<string, Notice>();
  for (const notice of notices) if (notice.userId && notice.userId !== actorId) unique.set(`${notice.userId}:${notice.taskId}`, notice);
  if (!unique.size) return;
  const userIds = [...new Set([...unique.values()].map(notice => notice.userId!))];
  const members = new Set<string>();
  for (let offset = 0; offset < userIds.length; offset += 1000) {
    const rows = await tx.membership.findMany({ where: { projectId, userId: { in: userIds.slice(offset, offset + 1000) } }, select: { userId: true } });
    rows.forEach(row => members.add(row.userId));
  }
  const data = [...unique.values()].filter(notice => members.has(notice.userId!)).map(notice => ({ ...notice, userId: notice.userId!, projectId, actorId }));
  if (!data.length) return;
  // Serialize ID allocation through commit: SSE cursors must never skip an earlier, late-committing ID.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(1700, 1)`;
  for (let offset = 0; offset < data.length; offset += 1000) await tx.notification.createMany({ data: data.slice(offset, offset + 1000) });
}
