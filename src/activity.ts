import type { Prisma } from '@prisma/client';
import type { Transaction } from './access.js';

/** Append an activity record inside the transaction that makes the associated change. */
export function recordActivity(tx: Transaction, projectId: string, actorId: string, action: string, entityId?: string, metadata: Prisma.InputJsonValue = {}) {
  return tx.activity.create({ data: { projectId, actorId, action, entityId, metadata } });
}
