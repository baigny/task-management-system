import { z } from 'zod';

const fields = { name: z.string().trim().min(1).max(100), description: z.string().max(5000) };
export const projectInput = z.object({ ...fields, description: fields.description.default('') }).strict();
