import { z } from 'zod';
export const id = z.string().uuid();
export const pagination = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Translate validated pagination into bounded database offset/limit arguments. */
export function pageArgs(page: number, limit: number) { return { skip: (page - 1) * limit, take: limit }; }

export type Page<T> = { items: T[]; total: number; page: number; limit: number };
