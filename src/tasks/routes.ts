import { Router } from 'express';
import { authenticate, noStore } from '../auth/middleware.js';
import { createTask, readTask, listProjectTasks, discoverTasks, updateTask } from './controller.js';

// The parent project router authenticates requests and disables response caching.
export const taskRoutes = Router({ mergeParams: true });
taskRoutes.post('/', createTask);
taskRoutes.get('/', listProjectTasks);
taskRoutes.get('/:taskId', readTask);
taskRoutes.patch('/:taskId', updateTask);

export const taskDiscoveryRoutes = Router();
taskDiscoveryRoutes.use(noStore, authenticate);
taskDiscoveryRoutes.get('/', discoverTasks);
