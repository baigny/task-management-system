import { z } from 'zod';
import { pagination } from '../validation.js';

const fields = { name: z.string().trim().min(1).max(100), description: z.string().max(5000) };
export const projectInput = z.object({ ...fields, description: fields.description.default('') }).strict();

// Update validation intentionally has no creation defaults: omitted fields stay unchanged.
export const projectUpdate = z.object(fields).partial().strict()
  .refine(value => Object.keys(value).length > 0, 'At least one project field is required');

export const projectListQuery = pagination.extend({ deleted: z.enum(['true', 'false']).default('false').transform(value => value === 'true') });
