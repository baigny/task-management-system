import type { Prisma, Task } from '@prisma/client';
import { db } from '../db.js';
import { inProject } from '../access.js';
import { requireActiveTask } from './access.js';
import { pageArgs, type Page } from '../validation.js';
import type { TaskDiscoveryQuery, TaskListQuery } from './validation.js';

/** Build literal substring filters without treating user-supplied LIKE characters as wildcards. */
function taskFilter(query: TaskListQuery, userId: string): Prisma.TaskWhereInput {
  const search = query.search?.replace(/[\\%_]/g, '\\$&');
  return {
    deletedAt: null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.assigneeId ? { assigneeId: query.assigneeId === 'me' ? userId : query.assigneeId === 'unassigned' ? null : query.assigneeId } : {}),
    ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
  };
}

/** Use only validated sort fields, placing absent due dates last and breaking ties by ID. */
function taskOrder(query: TaskListQuery): Prisma.TaskOrderByWithRelationInput[] {
  return [query.sortBy === 'dueDate' ? { dueDate: { sort: query.sortOrder, nulls: 'last' } } : { [query.sortBy]: query.sortOrder }, { id: 'asc' }];
}

/** Read one non-deleted task only within the authenticated member's active project. */
export function readTask(projectId: string, userId: string, taskId: string): Promise<Task> {
  return inProject(projectId, userId, tx => requireActiveTask(tx, projectId, taskId), { mode: 'read' });
}

/** List project tasks under a shared project lock so rows and count describe one state. */
export function listProjectTasks(projectId: string, userId: string, query: TaskListQuery): Promise<Page<Task>> {
  return inProject(projectId, userId, async tx => {
    const where = { ...taskFilter(query, userId), projectId };
    const items = await tx.task.findMany({ where, ...pageArgs(query.page, query.limit), orderBy: taskOrder(query) });
    return { items, total: await tx.task.count({ where }), page: query.page, limit: query.limit };
  }, { mode: 'read' });
}

/** Discover tasks across current memberships with a consistent snapshot and optional project filter. */
export async function discoverTasks(userId: string, query: TaskDiscoveryQuery): Promise<Page<Task>> {
  const where: Prisma.TaskWhereInput = {
    ...taskFilter(query, userId),
    ...(query.projectId ? { projectId: query.projectId } : {}),
    project: { deletedAt: null, memberships: { some: { userId } } },
  };
  const [items, total] = await db.$transaction([
    db.task.findMany({ where, ...pageArgs(query.page, query.limit), orderBy: taskOrder(query) }),
    db.task.count({ where }),
  ], { isolationLevel: 'RepeatableRead' });
  return { items, total, page: query.page, limit: query.limit };
}
