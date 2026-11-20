import { z } from 'zod';
import { id, pagination } from '../validation.js';

export const commentInput = z.object({ body: z.string().trim().min(1).max(5000), parentId: id.optional() }).strict();
export const commentQuery = pagination.strict();
export type CommentInput = z.infer<typeof commentInput>;
export type CommentQuery = z.infer<typeof commentQuery>;
