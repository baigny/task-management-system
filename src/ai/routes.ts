import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, getAuth, noStore } from '../auth/middleware.js';
import { generateDescription } from './controller.js';

export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10,
  keyGenerator: req => getAuth(req).userId,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many AI requests; try again later' } },
});
export const aiRoutes = Router();
aiRoutes.use(noStore, authenticate, aiLimiter);
aiRoutes.post('/descriptions', generateDescription);
