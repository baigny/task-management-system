import { TaskStatus, type Task } from '@prisma/client';
import { inProject } from '../access.js';
import { recordActivity } from '../activity.js';
import { validateAssignee } from './assignment.js';
import { requireTask } from './access.js';
import type { TaskInput, TaskUpdate } from './validation.js';
import { notifyMembers } from '../notifications/write.js';

/** Create a task only within an active project and validate its optional assignee under the same lock. */
export function createTask(projectId: string, userId: string, input: TaskInput): Promise<Task> {
  return inProject(projectId, userId, async tx => {
    await validateAssignee(tx, projectId, input.assigneeId);
    const task = await tx.task.create({ data: { ...input, projectId, createdById: userId } });
    await recordActivity(tx, projectId, userId, 'TASK_CREATED', task.id, { status: task.status, assigneeId: task.assigneeId });
    await notifyMembers(tx, projectId, userId, [{ taskId: task.id, userId: task.assigneeId, type: 'TASK_ASSIGNED' }]);
    return task;
  });
}

/** Identify actual changes using typed editable fields and compare due dates by instant. */
function changedFields(task: Task, input: TaskUpdate) {
  const editable = ['title', 'description', 'dueDate', 'status', 'assigneeId'] as const;
  return editable.filter(field => {
    const next = input[field];
    if (next === undefined) return false;
    const previous = task[field];
    return next instanceof Date ? !(previous instanceof Date) || next.getTime() !== previous.getTime() : next !== previous;
  });
}

/** Update only supplied fields and record meaningful edits and assignment changes atomically. */
export function updateTask(projectId: string, userId: string, taskId: string, input: TaskUpdate): Promise<Task> {
  return inProject(projectId, userId, async tx => {
    const task = await requireTask(tx, projectId, taskId);
    await validateAssignee(tx, projectId, input.assigneeId);
    // Reopening completed history must not reactivate an assignment to a departed member.
    if ((input.status ?? task.status) !== TaskStatus.COMPLETED && input.assigneeId === undefined) {
      await validateAssignee(tx, projectId, task.assigneeId);
    }
    const fields = changedFields(task, input);
    if (!fields.length) return task;
    const updated = await tx.task.update({ where: { id: task.id }, data: input });
    await recordActivity(tx, projectId, userId, 'TASK_UPDATED', task.id, { fields });
    if (updated.assigneeId !== task.assigneeId) {
      await recordActivity(tx, projectId, userId, 'TASK_REASSIGNED', task.id, { previousAssigneeId: task.assigneeId, assigneeId: updated.assigneeId, reason: 'TASK_UPDATE' });
    }
    await notifyMembers(tx, projectId, userId, updated.assigneeId !== task.assigneeId
      ? [{ taskId, userId: task.assigneeId, type: 'TASK_UNASSIGNED', metadata: { fields } }, { taskId, userId: updated.assigneeId, type: 'TASK_ASSIGNED', metadata: { fields } }]
      : [{ taskId, userId: updated.assigneeId, type: 'TASK_UPDATED', metadata: { fields } }]);
    return updated;
  });
}
