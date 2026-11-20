import type { Transaction } from '../access.js';
import { ApiError } from '../errors.js';

/** Validate any explicit non-null assignee while the caller holds the project's mutation lock. */
export async function validateAssignee(tx: Transaction, projectId: string, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const member = await tx.membership.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } });
  if (!member) throw new ApiError(400, 'INVALID_ASSIGNEE', 'Assignee must belong to this project');
}
