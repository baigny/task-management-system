import type { Prisma } from '@prisma/client';
import type { Transaction } from './access.js';

export type ActivityAction = 'PROJECT_CREATED' | 'PROJECT_UPDATED' | 'PROJECT_DELETED' | 'PROJECT_RESTORED'
  | 'INVITATION_CREATED' | 'INVITATION_REVOKED' | 'MEMBER_JOINED' | 'OWNERSHIP_TRANSFERRED';

/** Append an activity record inside the transaction that makes the associated change. */
export function recordActivity(tx: Transaction, projectId: string, actorId: string, action: ActivityAction, entityId?: string, metadata: Prisma.InputJsonValue = {}) {
  return tx.activity.create({ data: { projectId, actorId, action, entityId, metadata } });
}
