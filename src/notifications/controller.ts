import type { Request, Response } from 'express';
import { getAuth } from '../auth/middleware.js';
import { inboxQuery, notificationId, readAllInput } from './validation.js';
import * as notifications from './service.js';

/** Validate pagination and filters before reading the authenticated account's inbox. */
export async function listNotifications(req: Request, res: Response) {
  res.json(await notifications.listNotifications(getAuth(req).userId, inboxQuery.parse(req.query)));
}
/** Return the accessible unread badge count. */
export async function unreadCount(req: Request, res: Response) { res.json(await notifications.unreadCount(getAuth(req).userId)); }
/** Mark a single recipient-owned notice read without changing an existing timestamp. */
export async function markRead(req: Request, res: Response) { res.json(await notifications.markRead(getAuth(req).userId, notificationId.parse(req.params.notificationId))); }
/** Apply a bounded project filter to the account's mark-all-read operation. */
export async function markAllRead(req: Request, res: Response) { res.json(await notifications.markAllRead(getAuth(req).userId, readAllInput.parse(req.body).projectId)); }
