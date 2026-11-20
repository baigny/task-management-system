import { Router } from 'express';
import { authenticate, noStore } from '../auth/middleware.js';
import { listNotifications, unreadCount, markRead, markAllRead } from './controller.js';
import { streamNotifications } from './stream.js';

export const notificationRoutes = Router();
notificationRoutes.use(noStore, authenticate);
notificationRoutes.get('/', listNotifications);
notificationRoutes.get('/stream', streamNotifications);
notificationRoutes.get('/unread-count', unreadCount);
notificationRoutes.patch('/read-all', markAllRead);
notificationRoutes.patch('/:notificationId/read', markRead);
