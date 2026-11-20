import { z } from 'zod';
import { id, pagination } from '../validation.js';
import { activityActions } from '../activity.js';

export const activityQuery = pagination.extend({ action: z.enum(activityActions).optional(), actorId: id.optional(), taskId: id.optional() }).strict();
export const taskActivityQuery = activityQuery.omit({ taskId: true });
export type ActivityQuery = z.infer<typeof activityQuery>;
