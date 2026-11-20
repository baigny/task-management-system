import type { Activity, Project, Prisma } from '@prisma/client';
import type { Page } from '../validation.js';
import type { ProjectInput, ProjectUpdate } from './validation.js';
import { recordActivity } from '../activity.js';
import { ApiError } from '../errors.js';
import { inProject } from '../access.js';
import { pageArgs } from '../validation.js';
import { db } from '../db.js';
import { queueTaskFiles } from '../attachments/cleanup.js';

/** Create the project and its owner's membership atomically. */
export function createProject(userId: string, input: ProjectInput): Promise<Project> {
  return db.project.create({ data: { ...input, ownerId: userId, memberships: { create: { userId } }, activities: { create: { actorId: userId, action: 'PROJECT_CREATED' } } } });
}


/** List accessible projects with a consistent count and stable ordering. */
export async function listProjects(userId: string, page: number, limit: number, deleted = false): Promise<Page<Project>> {
  const where: Prisma.ProjectWhereInput = { memberships: { some: { userId } }, deletedAt: deleted ? { not: null } : null, ...(deleted ? { ownerId: userId } : {}) };
  const [items, total] = await db.$transaction([
    db.project.findMany({ where, ...pageArgs(page, limit), orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    db.project.count({ where }),
  ], { isolationLevel: 'RepeatableRead' });
  return { items, total, page, limit };
}

/** Read a project after confirming the caller's membership. */
export function readProject(projectId: string, userId: string): Promise<Project> {
  return inProject(projectId, userId, async (_tx, project) => project, { mode: 'read' });
}

/** Restrict project detail changes to the current project owner. */
export function updateProject(projectId: string, userId: string, input: ProjectUpdate): Promise<Project> {
  return inProject(projectId, userId, async (tx, project) => {
    const updated = await tx.project.update({ where: { id: project.id }, data: input });
    await recordActivity(tx, project.id, userId, 'PROJECT_UPDATED', project.id, { fields: Object.keys(input) });
    return updated;
  }, { ownerOnly: true });
}

/** Soft-delete a project without destroying its memberships or collaboration history. */
export function deleteProject(projectId: string, userId: string) {
  return inProject(projectId, userId, async (tx, project) => {
    await tx.project.update({ where: { id: project.id }, data: { deletedAt: new Date(), deletedById: userId } });
    await recordActivity(tx, project.id, userId, 'PROJECT_DELETED', project.id);
  }, { ownerOnly: true });
}

/** Restore a deleted project only for its owner, preserving existing memberships. */
export function restoreProject(projectId: string, userId: string) {
  return inProject(projectId, userId, async (tx, project) => {
    if (!project.deletedAt) throw new ApiError(409, 'CONFLICT', 'Project is already active');
    const restored = await tx.project.update({ where: { id: project.id }, data: { deletedAt: null, deletedById: null } });
    await recordActivity(tx, project.id, userId, 'PROJECT_RESTORED', project.id);
    return restored;
  }, { ownerOnly: true, includeDeleted: true });
}

/** Permanently purge only an already deleted project after an explicit owner request. */
export function purgeProject(projectId: string, userId: string) {
  return inProject(projectId, userId, async (tx, project) => {
    if (!project.deletedAt) throw new ApiError(409, 'CONFLICT', 'Soft-delete the project before permanent deletion');
    await queueTaskFiles(tx, projectId);
    await tx.project.delete({ where: { id: project.id } });
  }, { ownerOnly: true, includeDeleted: true });
}

/** Read project activity for members, permitting only owners to inspect deleted projects. */
export function listActivity(projectId: string, userId: string, page: number, limit: number): Promise<Page<Activity>> {
  return inProject(projectId, userId, async (tx, project) => {
    if (project.deletedAt && project.ownerId !== userId) throw new ApiError(404, 'NOT_FOUND', 'Project not found');
    const where = { projectId };
    const items = await tx.activity.findMany({ where, ...pageArgs(page, limit), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return { items, total: await tx.activity.count({ where }), page, limit };
  }, { includeDeleted: true, mode: 'read' });
}
