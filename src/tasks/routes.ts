import { Router } from 'express';
import { commentRoutes } from '../comments/routes.js';
import { authenticate, noStore } from '../auth/middleware.js';
import { createTask, readTask, listProjectTasks, discoverTasks, updateTask, deleteTask, restoreTask, purgeTask } from './controller.js';

// The parent project router authenticates requests and disables response caching.
export const taskRoutes = Router({ mergeParams: true });
taskRoutes.post('/', createTask);
taskRoutes.get('/', listProjectTasks);
taskRoutes.get('/:taskId', readTask);
taskRoutes.patch('/:taskId', updateTask);
taskRoutes.delete('/:taskId', deleteTask);
taskRoutes.post('/:taskId/restore', restoreTask);
taskRoutes.delete('/:taskId/permanent', purgeTask);
taskRoutes.use('/:taskId/comments', commentRoutes);

export const taskDiscoveryRoutes = Router();
taskDiscoveryRoutes.use(noStore, authenticate);
taskDiscoveryRoutes.get('/', discoverTasks);
