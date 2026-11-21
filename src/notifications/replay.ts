import type { AuthContext } from '../auth/types.js';
import { db } from '../db.js';
import { notificationInclude, visibleNotifications } from './service.js';

const REPLAY_BATCH_SIZE = 100;

/** Revalidate the session and current membership before reading one ordered replay batch. */
export async function readReplayBatch(auth: AuthContext, cursor: number) {
  const session = await db.session.findUnique({ where: { id: auth.sessionId }, select: { userId: true, expiresAt: true } });
  const now = new Date();
  if (!session || session.userId !== auth.userId || session.expiresAt <= now || auth.expiresAt <= now) return null;
  return db.notification.findMany({
    where: { ...visibleNotifications(auth.userId), id: { gt: cursor } },
    include: notificationInclude, orderBy: { id: 'asc' }, take: REPLAY_BATCH_SIZE,
  });
}
