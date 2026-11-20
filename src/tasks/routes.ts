import { Router } from 'express';
import { createTask } from './controller.js';

// The parent project router authenticates requests and disables response caching.
export const taskRoutes = Router({ mergeParams: true });
taskRoutes.post('/', createTask);
