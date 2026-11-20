import { Router } from 'express';
import { authenticate, noStore } from '../auth/middleware.js';
import { createProject } from './controller.js';

export const projectRoutes = Router();
projectRoutes.use(noStore, authenticate);
projectRoutes.post('/', createProject);
