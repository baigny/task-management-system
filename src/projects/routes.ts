import { Router } from 'express';
import { authenticate, noStore } from '../auth/middleware.js';
import { createProject, listProjects, readProject, updateProject, deleteProject, restoreProject, purgeProject, listActivity } from './controller.js';

export const projectRoutes = Router();
projectRoutes.use(noStore, authenticate);
projectRoutes.post('/', createProject);
projectRoutes.get('/', listProjects);
projectRoutes.get('/:projectId', readProject);
projectRoutes.patch('/:projectId', updateProject);
projectRoutes.delete('/:projectId', deleteProject);
projectRoutes.post('/:projectId/restore', restoreProject);
projectRoutes.delete('/:projectId/permanent', purgeProject);
projectRoutes.get('/:projectId/activity', listActivity);
