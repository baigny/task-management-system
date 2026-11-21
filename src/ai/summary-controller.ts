import type { Request, Response } from 'express';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import { summarizeTask } from './summary.js';
import { summaryInput } from './validation.js';

/** Bind task summaries to current project membership and reject caller-supplied task content. */
export async function generateSummary(req: Request, res: Response) {
  z.object({}).strict().parse(req.query);
  const { projectId, taskId } = summaryInput.parse(req.body);
  res.json(await summarizeTask(projectId, getAuth(req).userId, taskId));
}
