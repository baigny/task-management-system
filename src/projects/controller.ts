import { getAuth } from '../auth/middleware.js';
import type { Request, Response } from 'express';
import { id } from '../validation.js';
import { projectInput, projectUpdate, projectListQuery } from './validation.js';
import * as projects from './service.js';
import { activityQuery } from '../history/validation.js';
import { listHistory } from '../history/service.js';

/** Validate project creation and make the authenticated account its owner. */
export async function createProject(req: Request, res: Response) {
  res.status(201).json(await projects.createProject(getAuth(req).userId, projectInput.parse(req.body)));
}


/** Validate pagination before listing the authenticated account's projects. */
export async function listProjects(req: Request, res: Response) {
  const { page, limit, deleted } = projectListQuery.parse(req.query);
  res.json(await projects.listProjects(getAuth(req).userId, page, limit, deleted));
}

/** Validate the identifier before fetching an accessible project. */
export async function readProject(req: Request, res: Response) {
  res.json(await projects.readProject(id.parse(req.params.projectId), getAuth(req).userId));
}

/** Validate an owner-only update without changing omitted fields. */
export async function updateProject(req: Request, res: Response) {
  res.json(await projects.updateProject(id.parse(req.params.projectId), getAuth(req).userId, projectUpdate.parse(req.body)));
}

/** Soft-delete an authenticated owner's project. */
export async function deleteProject(req: Request, res: Response) {
  await projects.deleteProject(id.parse(req.params.projectId), getAuth(req).userId);
  res.sendStatus(204);
}

/** Restore an authenticated owner's deleted project. */
export async function restoreProject(req: Request, res: Response) {
  res.json(await projects.restoreProject(id.parse(req.params.projectId), getAuth(req).userId));
}

/** Permanently delete an owner's project only after it has been soft-deleted. */
export async function purgeProject(req: Request, res: Response) {
  await projects.purgeProject(id.parse(req.params.projectId), getAuth(req).userId);
  res.sendStatus(204);
}

/** Validate pagination before reading an authorized project's activity. */
export async function listActivity(req: Request, res: Response) {
  res.json(await listHistory(id.parse(req.params.projectId), getAuth(req).userId, activityQuery.parse(req.query)));
}
