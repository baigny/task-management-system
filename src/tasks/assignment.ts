import { TaskStatus, type Prisma } from '@prisma/client';
import type { Workload } from './types.js';
import type { Transaction } from '../access.js';
import { ApiError } from '../errors.js';

/** Validate any explicit non-null assignee while the caller holds the project's mutation lock. */
export async function validateAssignee(tx: Transaction, projectId: string, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const member = await tx.membership.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } });
  if (!member) throw new ApiError(400, 'INVALID_ASSIGNEE', 'Assignee must belong to this project');
}

/** Share the definition of workload so removal and restoration ignore completed/deleted tasks. */
export function unfinishedTaskWhere(projectId: string): Prisma.TaskWhereInput {
  return { projectId, deletedAt: null, status: { in: [TaskStatus.OPEN, TaskStatus.IN_PROGRESS] } };
}

/** Prefer remaining non-owner members, using the owner only when no other candidate remains. */
export async function automaticCandidates(tx: Transaction, projectId: string, ownerId: string, excludedUserId?: string) {
  const candidates = await tx.membership.findMany({ where: { projectId, ...(excludedUserId ? { userId: { not: excludedUserId } } : {}) }, select: { userId: true } });
  const members = candidates.filter(candidate => candidate.userId !== ownerId);
  return members.length ? members : candidates;
}

/** Count candidate workloads in one grouped query rather than issuing a query per member. */
export async function loadWorkloads(tx: Transaction, projectId: string, candidates: readonly { userId: string }[]): Promise<Workload[]> {
  const counts = await tx.task.groupBy({ by: ['assigneeId'], where: { ...unfinishedTaskWhere(projectId), assigneeId: { in: candidates.map(candidate => candidate.userId) } }, _count: { _all: true } });
  const workloads = new Map(counts.map(count => [count.assigneeId, count._count._all]));
  return candidates.map(candidate => ({ userId: candidate.userId, activeTasks: workloads.get(candidate.userId) ?? 0 }));
}
