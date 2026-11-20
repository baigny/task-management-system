import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate, noStore } from './middleware.js';
import { registerUser, loginUser, getProfile, updateUserProfile, logoutUser, logoutAllDevices } from './controller.js';
import { forgotPassword, resetUserPassword, changeUserPassword } from './recovery-controller.js';

export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many authentication attempts' } } });
export const authRoutes = Router();
authRoutes.use(noStore);
authRoutes.post('/register', authLimiter, registerUser);
authRoutes.post('/login', authLimiter, loginUser);
authRoutes.post('/logout', authenticate, logoutUser);
authRoutes.post('/logout-all', authenticate, logoutAllDevices);
const recoveryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many password recovery attempts' } } });
authRoutes.post('/forgot-password', recoveryLimiter, forgotPassword);
authRoutes.post('/reset-password', recoveryLimiter, resetUserPassword);
authRoutes.post('/change-password', recoveryLimiter, authenticate, changeUserPassword);

export const profileRoutes = Router();
profileRoutes.use(noStore, authenticate);
profileRoutes.get('/', getProfile);
profileRoutes.patch('/', updateUserProfile);
