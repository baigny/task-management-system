import { z } from 'zod';
import { id } from '../validation.js';
import { MAX_AI_IDEA_LENGTH } from '../limits.js';

/** Bound free-form input before it can reach the paid provider. */
export const descriptionInput = z.object({ input: z.string().trim().min(1).max(MAX_AI_IDEA_LENGTH) }).strict();

/** Accept only resource identifiers; summaries always use authorized persisted task content. */
export const summaryInput = z.object({ projectId: id, taskId: id }).strict();
