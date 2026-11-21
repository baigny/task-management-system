import type { Transaction } from '../access.js';
import { ApiError } from '../errors.js';

/** Fetch a task within an authorized project; trash access is used only by owner-guarded lifecycle operations. */
export async function requireTask(tx: Transaction, projectId: string, taskId: string, includeDeleted = false) {
  const task = await tx.task.findFirst({ where: { id: taskId, projectId, ...(includeDeleted ? {} : { deletedAt: null }) } });
  if (!task) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
  return task;
}
