import { inProject } from '../access.js';
import { pageArgs } from '../validation.js';
import { db } from '../db.js';

/** Create the project and its owner's membership atomically. */
export function createProject(userId: string, input: { name: string; description: string }) {
  return db.project.create({ data: { ...input, ownerId: userId, memberships: { create: { userId } } } });
}


/** List accessible projects with a consistent count and stable ordering. */
export async function listProjects(userId: string, page: number, limit: number) {
  const where = { memberships: { some: { userId } } };
  const [items, total] = await db.$transaction([
    db.project.findMany({ where, ...pageArgs(page, limit), orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    db.project.count({ where }),
  ], { isolationLevel: 'RepeatableRead' });
  return { items, total, page, limit };
}

/** Read a project after confirming the caller's membership. */
export function readProject(projectId: string, userId: string) {
  return inProject(projectId, userId, async (_tx, project) => project);
}
