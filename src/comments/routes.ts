import { Router } from 'express';
import { createComment, listComments, listReplies, deleteComment } from './controller.js';

// Authentication and no-store headers are inherited from the project router.
export const commentRoutes = Router({ mergeParams: true });
commentRoutes.post('/', createComment);
commentRoutes.get('/', listComments);
commentRoutes.get('/:commentId/replies', listReplies);
commentRoutes.delete('/:commentId', deleteComment);
