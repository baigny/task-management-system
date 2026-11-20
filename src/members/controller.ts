import { getAuth } from '../auth/middleware.js';
import type { Request, Response } from 'express';
import { transferInput } from './validation.js';
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
