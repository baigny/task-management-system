import type { Request, Response } from 'express';
import { id, pagination } from '../validation.js';
import { projectInput, projectUpdate } from './validation.js';
import * as projects from './service.js';

/** Validate project creation and make the authenticated account its owner. */
export async function createProject(req: Request, res: Response) {
  res.status(201).json(await projects.createProject(req.auth.userId, projectInput.parse(req.body)));
}


/** Validate pagination before listing the authenticated account's projects. */
export async function listProjects(req: Request, res: Response) {
  const { page, limit } = pagination.parse(req.query);
  res.json(await projects.listProjects(req.auth.userId, page, limit));
}

/** Validate the identifier before fetching an accessible project. */
export async function readProject(req: Request, res: Response) {
  res.json(await projects.readProject(id.parse(req.params.projectId), req.auth.userId));
}

/** Validate an owner-only update without changing omitted fields. */
export async function updateProject(req: Request, res: Response) {
  res.json(await projects.updateProject(id.parse(req.params.projectId), req.auth.userId, projectUpdate.parse(req.body)));
}
