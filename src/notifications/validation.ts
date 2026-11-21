import { z } from 'zod';
import { id, pagination } from '../validation.js';

export const notificationId = z.coerce.number().int().min(1).max(2147483647);
export const inboxQuery = pagination.extend({ unread: z.enum(['true', 'false']).optional().transform(value => value === undefined ? undefined : value === 'true'), projectId: id.optional() }).strict();
export const readAllInput = z.object({ projectId: id.optional() }).strict().default({});
export type InboxQuery = z.infer<typeof inboxQuery>;
