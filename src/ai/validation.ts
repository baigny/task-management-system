import { z } from 'zod';

/** Bound free-form input before it can reach the paid provider. */
export const descriptionInput = z.object({ input: z.string().trim().min(1).max(2000) }).strict();
