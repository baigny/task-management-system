import { Router } from 'express';
import { authenticate, noStore } from '../auth/middleware.js';
import { createProject, listProjects, readProject, updateProject } from './controller.js';

export const projectRoutes = Router();
projectRoutes.use(noStore, authenticate);
projectRoutes.post('/', createProject);
projectRoutes.get('/', listProjects);
projectRoutes.get('/:projectId', readProject);
projectRoutes.patch('/:projectId', updateProject);
