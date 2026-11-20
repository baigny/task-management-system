import type { Task } from '@prisma/client';
import { inProject } from '../access.js';
import { recordActivity } from '../activity.js';
import { ApiError } from '../errors.js';
import type { TaskInput } from './validation.js';

/** Create a task only within an active project and validate its optional assignee under the same lock. */
export function createTask(projectId: string, userId: string, input: TaskInput): Promise<Task> {
  return inProject(projectId, userId, async tx => {
    if (input.assigneeId) {
      const assignee = await tx.membership.findUnique({ where: { projectId_userId: { projectId, userId: input.assigneeId } } });
      if (!assignee) throw new ApiError(400, 'INVALID_ASSIGNEE', 'Assignee must belong to this project');
    }
    const task = await tx.task.create({ data: { ...input, projectId, createdById: userId } });
    await recordActivity(tx, projectId, userId, 'TASK_CREATED', task.id, { status: task.status, assigneeId: task.assigneeId });
    return task;
  });
}
