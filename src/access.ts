import type { Prisma, Project } from '@prisma/client';
import { db } from './db.js';
import { ApiError } from './errors.js';

export type Transaction = Prisma.TransactionClient;

/** Lock project changes and conceal project existence from nonmembers. */
export async function authorizeProject(tx: Transaction, projectId: string, userId: string, ownerOnly = false, includeDeleted = false): Promise<Project> {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id: projectId } });
  const member = await tx.membership.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!project || !member || (project.deletedAt && !includeDeleted)) throw new ApiError(404, 'NOT_FOUND', 'Project not found');
  if (ownerOnly && project.ownerId !== userId) throw new ApiError(403, 'FORBIDDEN', 'Project owner required');
  return project;
}

/** Run an authorized project operation under one transaction and one project lock. */
export function inProject<T>(projectId: string, userId: string, action: (tx: Transaction, project: Project) => Promise<T>, ownerOnly = false, includeDeleted = false) {
  return db.$transaction(async tx => action(tx, await authorizeProject(tx, projectId, userId, ownerOnly, includeDeleted)));
}
