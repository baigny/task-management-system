import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { inProject } from '../access.js';
import { recordActivity } from '../activity.js';
import { ApiError } from '../errors.js';
import { pageArgs } from '../validation.js';

const publicInvitation = { id: true, projectId: true, email: true, invitedById: true, expiresAt: true, createdAt: true, acceptedAt: true, revokedAt: true } as const;
/** Hash invitation secrets so database records cannot be used as bearer tokens. */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Issue a seven-day email-bound token, invalidating any previous invitation for that email. */
export function inviteMember(projectId: string, userId: string, email: string) {
  return inProject(projectId, userId, async (tx, project) => {
    const member = await tx.membership.findFirst({ where: { projectId, user: { email } } });
    if (member) throw new ApiError(409, 'CONFLICT', 'Account already belongs to this project');
    const token = randomBytes(32).toString('hex');
    const data = { invitedById: userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), createdAt: new Date(), acceptedAt: null, revokedAt: null };
    const invitation = await tx.invitation.upsert({ where: { projectId_email: { projectId, email } }, create: { projectId, email, ...data }, update: data, select: publicInvitation });
    await recordActivity(tx, project.id, userId, 'INVITATION_CREATED', invitation.id);
    return { invitation, token };
  }, true);
}

/** Restrict invitation records to the owner and exclude token hashes from responses. */
export function listInvitations(projectId: string, userId: string, page: number, limit: number) {
  return inProject(projectId, userId, async tx => {
    const where = { projectId };
    const items = await tx.invitation.findMany({ where, ...pageArgs(page, limit), orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], select: publicInvitation });
    return { items, total: await tx.invitation.count({ where }), page, limit };
  }, true);
}

/** Revoke an unused invitation while retaining an activity record of the action. */
export function revokeInvitation(projectId: string, userId: string, invitationId: string) {
  return inProject(projectId, userId, async tx => {
    const invitation = await tx.invitation.findFirst({ where: { id: invitationId, projectId } });
    if (!invitation) throw new ApiError(404, 'NOT_FOUND', 'Invitation not found');
    if (invitation.acceptedAt) throw new ApiError(409, 'CONFLICT', 'Invitation has already been accepted');
    if (!invitation.revokedAt) {
      await tx.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
      await recordActivity(tx, projectId, userId, 'INVITATION_REVOKED', invitation.id);
    }
  }, true);
}

/** Consume an invitation once under the project lock and create membership atomically. */
export function acceptInvitation(userId: string, token: string) {
  return db.$transaction(async tx => {
    const candidate = await tx.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!candidate) throw new ApiError(400, 'INVALID_INVITATION', 'Invitation is invalid or unavailable');
    // Use the same project lock as owner changes, deletion, and membership operations.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${candidate.projectId} FOR UPDATE`;
    const invitation = await tx.invitation.findUnique({ where: { id: candidate.id } });
    const project = await tx.project.findUnique({ where: { id: candidate.projectId } });
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!invitation || invitation.tokenHash !== hashToken(token) || !project || project.deletedAt || !user || invitation.email !== user.email || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) {
      throw new ApiError(400, 'INVALID_INVITATION', 'Invitation is invalid or unavailable');
    }
    if (await tx.membership.findUnique({ where: { projectId_userId: { projectId: project.id, userId } } })) {
      throw new ApiError(409, 'CONFLICT', 'Account already belongs to this project');
    }
    await tx.membership.create({ data: { projectId: project.id, userId } });
    await tx.invitation.update({ where: { id: invitation.id }, data: { acceptedAt: new Date() } });
    await recordActivity(tx, project.id, userId, 'MEMBER_JOINED', userId);
    return project;
  });
}
