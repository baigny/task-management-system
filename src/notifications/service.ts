import type { NotificationType, Prisma } from '@prisma/client';
import { db } from '../db.js';
import { ApiError } from '../errors.js';
import { pageArgs } from '../validation.js';
import type { InboxQuery } from './validation.js';

export const notificationInclude = { actor: { select: { id: true, name: true } }, project: { select: { id: true, name: true } }, task: { select: { id: true, title: true, status: true, deletedAt: true } } } as const;
const messages: Record<NotificationType, string> = { TASK_ASSIGNED: 'assigned you a task', TASK_UNASSIGNED: 'removed your task assignment', TASK_UPDATED: 'updated your task', TASK_DELETED: 'deleted your task', TASK_RESTORED: 'restored your task', COMMENT_ADDED: 'commented on your task', COMMENT_REPLIED: 'replied to your task thread', ATTACHMENT_ADDED: 'added a task attachment', ATTACHMENT_DELETED: 'removed a task attachment' };

/** Build a readable message from current authorized context rather than storing sensitive text snapshots. */
export function presentNotification(notice: Prisma.NotificationGetPayload<{ include: typeof notificationInclude }>) {
  return { ...notice, message: `${notice.actor?.name ?? 'A team member'} ${messages[notice.type]}: ${notice.task.title}` };
}

/** Scope every inbox/read/replay query to its recipient and current project membership. */
export function visibleNotifications(userId: string, projectId?: string): Prisma.NotificationWhereInput {
  return { userId, ...(projectId ? { projectId } : {}), project: { deletedAt: null, memberships: { some: { userId } } },
    OR: [{ task: { deletedAt: null } }, { type: 'TASK_DELETED' }] };
}

/** Read a consistent bounded inbox and unread count without leaking inaccessible projects. */
export function listNotifications(userId: string, query: InboxQuery) {
  const visible = visibleNotifications(userId, query.projectId);
  const where = { ...visible, ...(query.unread === undefined ? {} : { readAt: query.unread ? null : { not: null } }) };
  return db.$transaction(async tx => ({
    items: (await tx.notification.findMany({ where, include: notificationInclude, orderBy: { id: 'desc' }, ...pageArgs(query.page, query.limit) })).map(presentNotification),
    total: await tx.notification.count({ where }), unreadCount: await tx.notification.count({ where: { ...visible, readAt: null } }), page: query.page, limit: query.limit,
  }), { isolationLevel: 'RepeatableRead' });
}

/** Count only unread notices the account can currently access. */
export async function unreadCount(userId: string) {
  return { unreadCount: await db.notification.count({ where: { ...visibleNotifications(userId), readAt: null } }) };
}

/** Preserve the first read timestamp; other recipients and lost memberships always return 404. */
export function markRead(userId: string, id: number) {
  return db.$transaction(async tx => {
    const where = { ...visibleNotifications(userId), id };
    await tx.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } });
    const notice = await tx.notification.findFirst({ where, include: notificationInclude });
    if (!notice) throw new ApiError(404, 'NOT_FOUND', 'Notification not found');
    return presentNotification(notice);
  });
}

/** Mark current accessible notices read in one write, optionally limited to one project. */
export async function markAllRead(userId: string, projectId?: string) {
  const result = await db.notification.updateMany({ where: { ...visibleNotifications(userId, projectId), readAt: null }, data: { readAt: new Date() } });
  return { updatedCount: result.count };
}
