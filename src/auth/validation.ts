import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email().max(254);
export const name = z.string().trim().min(1).max(100);
export const password = z.string().min(12).max(128);
export const credentials = z.object({ email, password: z.string().min(1).max(128) }).strict();

/** Confirmation protects against typing mistakes and is never persisted. */
export const registration = z.object({ email, name, password, confirmPassword: password }).strict()
  .refine(value => value.password === value.confirmPassword, { path: ['confirmPassword'], message: 'Passwords must match' });
