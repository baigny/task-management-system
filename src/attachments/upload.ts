import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import type { Request, Response } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { validateFileName } from './storage.js';
import { MAX_ATTACHMENT_BYTES } from '../limits.js';

/** Make failed uploads eligible for deletion; the preexisting reservation survives database outages. */
export async function abandonUpload(key: string, req: Request) {
  try { await db.fileCleanup.updateMany({ where: { storageKey: key }, data: { availableAt: new Date() } }); }
  catch { req.log.error('Failed to expedite upload cleanup; reservation remains queued'); }
}

/** Reserve cleanup before writing so process crashes cannot leave permanently orphaned uploads. */
export async function receiveUpload(req: Request, res: Response) {
  const key = randomUUID();
  await db.fileCleanup.create({ data: { storageKey: key, availableAt: new Date(Date.now() + 60 * 60 * 1000) } });
  try {
    await mkdir(config.UPLOAD_DIR, { recursive: true });
    const upload = multer({
      storage: multer.diskStorage({
        destination: config.UPLOAD_DIR,
        /** Use only the generated key, never an incoming filename, for filesystem storage. */
        filename(_req, _file, callback) { callback(null, key); },
      }),
      limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0, parts: 1, fieldNameSize: 100, headerPairs: 50 },
      /** Reject unsupported filename/media-type pairs before streaming their content to disk. */
      fileFilter(_req, file, callback) {
        try { validateFileName(file.originalname, file.mimetype); callback(null, true); }
        catch (error) { callback(error instanceof Error ? error : new Error('Invalid file')); }
      },
    }).single('file');
    await new Promise<void>((resolve, reject) => { upload(req, res, error => { if (error) reject(error); else resolve(); }); });
    if (!req.file) throw new ApiError(400, 'FILE_REQUIRED', 'Upload one file using multipart field file');
    return req.file;
  } catch (error) { await abandonUpload(key, req); throw error; }
}
