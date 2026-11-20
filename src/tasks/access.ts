import type { Transaction } from '../access.js';
import { ApiError } from '../errors.js';

/** Fetch an active task only inside the already authorized project transaction. */
export async function requireActiveTask(tx: Transaction, projectId: string, taskId: string) {
  const task = await tx.task.findFirst({ where: { id: taskId, projectId, deletedAt: null } });
  if (!task) throw new ApiError(404, 'NOT_FOUND', 'Task not found');
  return task;
}
