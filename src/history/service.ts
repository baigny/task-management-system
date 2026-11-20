import { inProject } from '../access.js';
import { ApiError } from '../errors.js';
import { requireTask } from '../tasks/access.js';
import { pageArgs } from '../validation.js';
import type { ActivityQuery } from './validation.js';

/** Read immutable project/task events with current authorization, public actors, and bounded filters. */
export function listHistory(projectId: string, userId: string, query: ActivityQuery, taskId = query.taskId) {
  return inProject(projectId, userId, async (tx, project) => {
    const owner = project.ownerId === userId;
    if (project.deletedAt && !owner) throw new ApiError(404, 'NOT_FOUND', 'Project not found');
    if (taskId) await requireTask(tx, projectId, taskId, owner);
    const where = { projectId, ...(taskId ? { taskId } : {}), ...(query.action ? { action: query.action } : {}), ...(query.actorId ? { actorId: query.actorId } : {}) };
    const items = await tx.activity.findMany({ where, include: { actor: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], ...pageArgs(query.page, query.limit) });
    return { items, total: await tx.activity.count({ where }), page: query.page, limit: query.limit };
  }, { includeDeleted: true, mode: 'read' });
}
