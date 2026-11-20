import type { Prisma } from '@prisma/client';
import type { Transaction } from './access.js';

export const activityActions = ['PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_DELETED', 'PROJECT_RESTORED',
  'COMMENT_CREATED', 'COMMENT_DELETED', 'ATTACHMENT_CREATED', 'ATTACHMENT_DELETED',
  'INVITATION_CREATED', 'INVITATION_REVOKED', 'MEMBER_JOINED', 'OWNERSHIP_TRANSFERRED', 'MEMBER_REMOVED', 'MEMBER_LEFT',
  'TASK_REASSIGNED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED', 'TASK_RESTORED', 'TASK_PURGED'] as const;
export type ActivityAction = typeof activityActions[number];

/** Link task and collaboration events without keeping a foreign key after permanent task deletion. */
function relatedTask(action: ActivityAction, entityId: string | undefined, metadata: Prisma.InputJsonValue) {
  if (action.startsWith('TASK_')) return action === 'TASK_PURGED' ? undefined : entityId;
  if (typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata) && 'taskId' in metadata && typeof metadata.taskId === 'string') return metadata.taskId;
  return undefined;
}

/** Append an activity record inside the transaction that makes the associated change. */
export function recordActivity(tx: Transaction, projectId: string, actorId: string, action: ActivityAction, entityId?: string, metadata: Prisma.InputJsonValue = {}) {
  return tx.activity.create({ data: { projectId, actorId, action, entityId, metadata, taskId: relatedTask(action, entityId, metadata) } });
}

export type ActivityRecord = Omit<Prisma.ActivityCreateManyInput, 'action'> & { action: ActivityAction };

/** Insert activity in bounded batches so reassignment does not issue one query per task. */
export async function recordActivities(tx: Transaction, records: ActivityRecord[]) {
  for (let offset = 0; offset < records.length; offset += 1000) {
    await tx.activity.createMany({ data: records.slice(offset, offset + 1000) });
  }
}
