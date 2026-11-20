import type { Request, Response } from 'express';
import { z } from 'zod';
import { id, pagination } from '../validation.js';
import * as members from './service.js';

const transferInput = z.object({ newOwnerId: id }).strict();

/** Validate pagination before listing profiles and project-specific roles. */
export async function listMembers(req: Request, res: Response) {
  const { page, limit } = pagination.parse(req.query);
  res.json(await members.listMembers(id.parse(req.params.projectId), req.auth.userId, page, limit));
}

/** Validate the nominated member before transferring ownership under the project lock. */
export async function transferOwnership(req: Request, res: Response) {
  const { newOwnerId } = transferInput.parse(req.body);
  res.json(await members.transferOwnership(id.parse(req.params.projectId), req.auth.userId, newOwnerId));
}
