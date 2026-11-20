import type { Request, Response } from 'express';
import { projectInput } from './validation.js';
import * as projects from './service.js';

/** Validate project creation and make the authenticated account its owner. */
export async function createProject(req: Request, res: Response) {
  res.status(201).json(await projects.createProject(req.auth.userId, projectInput.parse(req.body)));
}

