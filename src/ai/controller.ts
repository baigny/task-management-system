import type { Request, Response } from 'express';
import { z } from 'zod';
import { descriptionInput } from './validation.js';
import { suggestDescription } from './service.js';

/** Validate the idea and return a suggestion without creating or changing a task. */
export async function generateDescription(req: Request, res: Response) {
  z.object({}).strict().parse(req.query);
  const { input } = descriptionInput.parse(req.body);
  res.json(await suggestDescription(input));
}
