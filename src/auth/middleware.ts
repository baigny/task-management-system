import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

declare module 'express-serve-static-core' {
  interface Request { auth: { userId: string; sessionId: string } }
}

/** Check both the JWT signature and its unexpired, revocable database session. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')?.[1];
  if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Bearer token required');
  let claims: { sub: string; sid: string; exp: number };
  try {
    claims = z.object({ sub: z.string().uuid(), sid: z.string().uuid(), exp: z.number().int() }).parse(jwt.verify(token, config.JWT_SECRET, {
      algorithms: ['HS256'], issuer: 'task-management', audience: 'task-api',
    }));
  } catch { throw new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token'); }
  const session = await db.session.findUnique({ where: { id: claims.sid } });
  if (!session || session.userId !== claims.sub || session.expiresAt <= new Date()) {
    throw new ApiError(401, 'UNAUTHORIZED', 'Session expired or revoked');
  }
  req.auth = { userId: claims.sub, sessionId: claims.sid };
  next();
};

/** Authentication data must not be retained by browser or intermediary caches. */
export const noStore: RequestHandler = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };
