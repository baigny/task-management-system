import { inProject } from '../access.js';
import { publicUser } from '../auth/service.js';
import { recordActivity } from '../activity.js';
import { pageArgs } from '../validation.js';
import { ApiError } from '../errors.js';

/** Return public member profiles and derive each role from the project's single owner. */
export function listMembers(projectId: string, userId: string, page: number, limit: number) {
  return inProject(projectId, userId, async (tx, project) => {
    const where = { projectId };
    const members = await tx.membership.findMany({ where, ...pageArgs(page, limit), orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }], include: { user: { select: publicUser } } });
    const items = members.map(member => ({ ...member, role: member.userId === project.ownerId ? 'OWNER' : 'MEMBER' }));
    return { items, total: await tx.membership.count({ where }), page, limit };
  });
}

/** Transfer ownership to an existing member while keeping the previous owner as a member. */
export function transferOwnership(projectId: string, userId: string, newOwnerId: string) {
  return inProject(projectId, userId, async (tx, project) => {
    if (newOwnerId === project.ownerId) throw new ApiError(409, 'CONFLICT', 'Account already owns this project');
    const member = await tx.membership.findUnique({ where: { projectId_userId: { projectId, userId: newOwnerId } } });
    if (!member) throw new ApiError(400, 'INVALID_OWNER', 'New owner must be a current project member');
    const updated = await tx.project.update({ where: { id: projectId }, data: { ownerId: newOwnerId } });
    await recordActivity(tx, projectId, userId, 'OWNERSHIP_TRANSFERRED', projectId, { previousOwnerId: project.ownerId, newOwnerId });
    return updated;
  }, true);
}
