import { z } from 'zod';
export const invitationInput = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
export const acceptanceInput = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
