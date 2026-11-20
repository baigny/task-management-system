import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { getAuth } from '../auth/middleware.js';
import { inProject } from '../access.js';
import { requireTask } from '../tasks/access.js';
import { id } from '../validation.js';
import { receiveUpload, abandonUpload } from './upload.js';
import * as attachments from './service.js';

/** Authorize before reading upload bytes, then recheck access inside the persistence transaction. */
export async function uploadAttachment(req: Request, res: Response) {
  const projectId = id.parse(req.params.projectId);
  const taskId = id.parse(req.params.taskId);
  const userId = getAuth(req).userId;
  await inProject(projectId, userId, tx => requireTask(tx, projectId, taskId), { mode: 'read' });
  const file = await receiveUpload(req, res);
  try { res.status(201).json(await attachments.createAttachment(projectId, userId, taskId, file)); }
  catch (error) { await abandonUpload(file.filename, req); throw error; }
}

/** Validate pagination before listing protected attachment metadata. */
export async function listAttachments(req: Request, res: Response) {
  res.json(await attachments.listAttachments(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId), attachments.attachmentQuery.parse(req.query)));
}

/** Stream an authorized open handle as an attachment without publishing a storage URL. */
export async function downloadAttachment(req: Request, res: Response) {
  const { attachment, handle } = await attachments.downloadAttachment(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId), id.parse(req.params.attachmentId));
  try {
    res.attachment(attachment.originalName).type(attachment.mimeType).set('Content-Length', String(attachment.size));
    await pipeline(handle.createReadStream(), res);
  } catch (error) {
    if (res.headersSent) res.destroy(error instanceof Error ? error : undefined);
    else throw error;
  } finally { await handle.close(); }
}

/** Delete uploader/owner-authorized metadata and leave durable file cleanup to the worker. */
export async function deleteAttachment(req: Request, res: Response) {
  await attachments.deleteAttachment(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId), id.parse(req.params.attachmentId));
  res.sendStatus(204);
}
