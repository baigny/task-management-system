import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { uploadAttachment, listAttachments, downloadAttachment, deleteAttachment } from './controller.js';

export const attachmentRoutes = Router({ mergeParams: true });
// Inherited authentication runs before this route-scoped multipart parser and IP limit.
const uploadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attachment uploads' } } });
attachmentRoutes.post('/', uploadLimiter, uploadAttachment);
attachmentRoutes.get('/', listAttachments);
attachmentRoutes.get('/:attachmentId/download', downloadAttachment);
attachmentRoutes.delete('/:attachmentId', deleteAttachment);
