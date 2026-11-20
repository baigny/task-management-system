import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}

/** Expose expected client errors; keep database and internal details private. */
export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, _next) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    res.status(409).json({ error: { code: 'CONFLICT', message: 'Resource already exists' } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.issues } });
    return;
  }
  if (error instanceof ApiError) {
    if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error && typeof error === 'object' && 'type' in error && (error.type === 'entity.parse.failed' || error.type === 'entity.too.large')) {
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: { code: 'INVALID_BODY', message: 'Invalid or oversized JSON body' } });
    return;
  }
  req.log.error({ err: error }, 'Request failed');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
