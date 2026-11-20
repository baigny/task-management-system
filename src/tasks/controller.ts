import type { Request, Response } from 'express';
import { getAuth } from '../auth/middleware.js';
import { id } from '../validation.js';
import { readTask as read, listProjectTasks as list, discoverTasks as discover } from './read.js';
import { taskInput, taskListQuery, taskDiscoveryQuery } from './validation.js';
import * as tasks from './service.js';

/** Validate task fields and bind project and creator identifiers to the authenticated request. */
export async function createTask(req: Request, res: Response) {
  res.status(201).json(await tasks.createTask(id.parse(req.params.projectId), getAuth(req).userId, taskInput.parse(req.body)));
}

/** Validate the project and task identifiers before reading a member-visible task. */
export async function readTask(req: Request, res: Response) {
  res.json(await read(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId)));
}

/** Validate bounded filters and allowlisted sorting before listing project tasks. */
export async function listProjectTasks(req: Request, res: Response) {
  res.json(await list(id.parse(req.params.projectId), getAuth(req).userId, taskListQuery.parse(req.query)));
}

/** Validate cross-project discovery filters, taking the account ID from the session. */
export async function discoverTasks(req: Request, res: Response) {
  res.json(await discover(getAuth(req).userId, taskDiscoveryQuery.parse(req.query)));
}
