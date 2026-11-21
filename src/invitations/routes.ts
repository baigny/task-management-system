import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, noStore } from '../auth/middleware.js';
import { acceptInvitation } from './controller.js';

export const invitationRoutes = Router();
invitationRoutes.use(noStore, authenticate);
// Limit token submissions independently of account login limits.
invitationRoutes.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many invitation attempts' } } }));
invitationRoutes.post('/accept', acceptInvitation);
