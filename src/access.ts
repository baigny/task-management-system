import type { Prisma, Project } from '@prisma/client';
import { db } from './db.js';
import { ApiError } from './errors.js';

export type Transaction = Prisma.TransactionClient;
export type ProjectAccessOptions = { ownerOnly?: boolean; includeDeleted?: boolean; mode?: 'read' | 'write' };

/** Lock project changes and conceal project existence from nonmembers. */
export async function authorizeProject(tx: Transaction, projectId: string, userId: string, options: ProjectAccessOptions = {}): Promise<Project> {
  // Shared locks allow parallel readers while membership/lifecycle mutations remain exclusive.
  if (options.mode === 'read') await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR SHARE`;
  else await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId } });
  const member = await tx.membership.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!project || !member || (project.deletedAt && !options.includeDeleted)) throw new ApiError(404, 'NOT_FOUND', 'Project not found');
  if (options.ownerOnly && project.ownerId !== userId) throw new ApiError(403, 'FORBIDDEN', 'Project owner required');
  return project;
}

/** Run an authorized project operation under one transaction and one project lock. */
export function inProject<T>(projectId: string, userId: string, action: (tx: Transaction, project: Project) => Promise<T>, options: ProjectAccessOptions = {}) {
  return db.$transaction(async tx => action(tx, await authorizeProject(tx, projectId, userId, options)));
}
