import type { Task } from '@prisma/client';
import { inProject } from '../access.js';
import { recordActivity } from '../activity.js';
import { ApiError } from '../errors.js';
import { requireTask } from './access.js';
import { automaticCandidates, loadWorkloads } from './assignment.js';
import { allocateTasks } from './allocation.js';

/** Let any current member soft-delete an active task without destroying its history. */
export function deleteTask(projectId: string, userId: string, taskId: string) {
  return inProject(projectId, userId, async tx => {
    const task = await requireTask(tx, projectId, taskId);
    await tx.task.update({ where: { id: task.id }, data: { deletedAt: new Date(), deletedById: userId } });
    await recordActivity(tx, projectId, userId, 'TASK_DELETED', task.id);
  });
}

/** Restore only for the owner and replace departed assignees before the task becomes visible. */
export function restoreTask(projectId: string, userId: string, taskId: string): Promise<Task> {
  return inProject(projectId, userId, async (tx, project) => {
    const task = await requireTask(tx, projectId, taskId, true);
    if (!task.deletedAt) throw new ApiError(409, 'CONFLICT', 'Task is already active');
    let assigneeId = task.assigneeId;
    if (assigneeId && !await tx.membership.findUnique({ where: { projectId_userId: { projectId, userId: assigneeId } } })) {
      const candidates = await automaticCandidates(tx, projectId, project.ownerId);
      const plan = allocateTasks([task.id], await loadWorkloads(tx, projectId, candidates));
      const replacement = plan.assignments.at(0);
      if (!replacement) throw new Error('Task restoration requires a replacement assignee');
      assigneeId = replacement.assigneeId;
    }
    const restored = await tx.task.update({ where: { id: task.id }, data: { deletedAt: null, deletedById: null, assigneeId } });
    await recordActivity(tx, projectId, userId, 'TASK_RESTORED', task.id);
    if (assigneeId !== task.assigneeId) {
      await recordActivity(tx, projectId, userId, 'TASK_REASSIGNED', task.id, { previousAssigneeId: task.assigneeId, assigneeId, reason: 'TASK_RESTORE' });
    }
    return restored;
  }, { ownerOnly: true });
}

/** Permanently remove only an already deleted task while retaining a project activity record. */
export function purgeTask(projectId: string, userId: string, taskId: string) {
  return inProject(projectId, userId, async tx => {
    const task = await requireTask(tx, projectId, taskId, true);
    if (!task.deletedAt) throw new ApiError(409, 'CONFLICT', 'Soft-delete the task before permanent deletion');
    await tx.task.delete({ where: { id: task.id } });
    await recordActivity(tx, projectId, userId, 'TASK_PURGED', task.id);
  }, { ownerOnly: true });
}
