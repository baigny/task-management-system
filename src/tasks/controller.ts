import type { Request, Response } from 'express';
import { getAuth } from '../auth/middleware.js';
import { id } from '../validation.js';
import { taskInput } from './validation.js';
import * as tasks from './service.js';

/** Validate task fields and bind project and creator identifiers to the authenticated request. */
export async function createTask(req: Request, res: Response) {
  res.status(201).json(await tasks.createTask(id.parse(req.params.projectId), getAuth(req).userId, taskInput.parse(req.body)));
}
