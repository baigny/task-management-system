import { getAuth } from '../auth/middleware.js';
import type { Request, Response } from 'express';
import { previewRemoval, removeMember } from './removal.js';
import { removalInput, transferInput } from './validation.js';
import { id, pagination } from '../validation.js';
import * as members from './service.js';

/** Validate pagination before listing profiles and project-specific roles. */
export async function listMembers(req: Request, res: Response) {
  const { page, limit } = pagination.parse(req.query);
  res.json(await members.listMembers(id.parse(req.params.projectId), getAuth(req).userId, page, limit));
}

/** Validate the nominated member before transferring ownership under the project lock. */
export async function transferOwnership(req: Request, res: Response) {
  const { newOwnerId } = transferInput.parse(req.body);
  res.json(await members.transferOwnership(id.parse(req.params.projectId), getAuth(req).userId, newOwnerId));
}

/** Validate the target and selected reassignment mode before previewing member removal. */
export async function previewMemberRemoval(req: Request, res: Response) {
  res.json(await previewRemoval(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.userId), removalInput.parse(req.body ?? {})));
}

/** Remove a member or leave the project using a freshly calculated reassignment plan. */
export async function removeProjectMember(req: Request, res: Response) {
  res.json(await removeMember(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.userId), removalInput.parse(req.body ?? {})));
}
