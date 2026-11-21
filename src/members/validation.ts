import { z } from 'zod';
import { id } from '../validation.js';

export const transferInput = z.object({ newOwnerId: id }).strict();

// Automatic is the default; manual replacement must be explicit and complete.
export const removalInput = z.union([
  z.object({ mode: z.literal('AUTOMATIC').default('AUTOMATIC') }).strict(),
  z.object({ mode: z.literal('MANUAL'), replacementUserId: id }).strict(),
]);
export type RemovalInput = z.output<typeof removalInput>;
