import type { Request, Response } from 'express';
import { getAuth } from '../auth/middleware.js';
import { id } from '../validation.js';
import { readTask as read, listProjectTasks as list, discoverTasks as discover } from './read.js';
import { taskInput, taskUpdate, taskListQuery, taskDiscoveryQuery } from './validation.js';
import * as tasks from './service.js';
import * as lifecycle from './lifecycle.js';
import { listHistory } from '../history/service.js';
import { taskActivityQuery } from '../history/validation.js';

/** List task-specific history, allowing owners to inspect task trash without restoring it. */
export async function listTaskActivity(req: Request, res: Response) {
  res.json(await listHistory(id.parse(req.params.projectId), getAuth(req).userId, taskActivityQuery.parse(req.query), id.parse(req.params.taskId)));
}

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

/** Validate a nonempty partial update while keeping project, creator, and deletion fields protected. */
export async function updateTask(req: Request, res: Response) {
  res.json(await tasks.updateTask(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId), taskUpdate.parse(req.body)));
}

/** Soft-delete a task as a current project member. */
export async function deleteTask(req: Request, res: Response) {
  await lifecycle.deleteTask(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId));
  res.sendStatus(204);
}

/** Restore a task as the project owner, revalidating any historical assignee. */
export async function restoreTask(req: Request, res: Response) {
  res.json(await lifecycle.restoreTask(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId)));
}

/** Permanently purge an owner's task only after soft deletion. */
export async function purgeTask(req: Request, res: Response) {
  await lifecycle.purgeTask(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId));
  res.sendStatus(204);
}
