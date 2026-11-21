import type { Request, Response } from 'express';
import { z } from 'zod';
import { id } from '../validation.js';
import { getAuth } from '../auth/middleware.js';
import { summarizeTask } from './summary.js';

const summaryInput = z.object({ projectId: id, taskId: id }).strict();

/** Bind task summaries to current project membership and reject caller-supplied task content. */
export async function generateSummary(req: Request, res: Response) {
  z.object({}).strict().parse(req.query);
  const { projectId, taskId } = summaryInput.parse(req.body);
  res.json(await summarizeTask(projectId, getAuth(req).userId, taskId));
}
