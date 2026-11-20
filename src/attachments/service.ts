import { open } from 'node:fs/promises';
import { inProject } from '../access.js';
import { recordActivity } from '../activity.js';
import { ApiError } from '../errors.js';
import { requireTask } from '../tasks/access.js';
import { pageArgs } from '../validation.js';
import type { z } from 'zod';
import { pagination } from '../validation.js';
import { storagePath, validateFileContent } from './storage.js';
import { notifyMembers } from '../notifications/write.js';

export const attachmentQuery = pagination.strict();
const select = { id: true, taskId: true, uploaderId: true, originalName: true, mimeType: true, size: true, createdAt: true } as const;

/** Recheck membership after upload and atomically replace the temporary cleanup reservation. */
export async function createAttachment(projectId: string, userId: string, taskId: string, file: Express.Multer.File) {
  await validateFileContent(file);
  return inProject(projectId, userId, async tx => {
    const task = await requireTask(tx, projectId, taskId);
    const reservation = await tx.fileCleanup.deleteMany({ where: { storageKey: file.filename, availableAt: { gt: new Date() } } });
    if (reservation.count !== 1) throw new ApiError(409, 'UPLOAD_EXPIRED', 'Upload reservation expired; upload again');
    const attachment = await tx.attachment.create({ data: { taskId, uploaderId: userId, storageKey: file.filename, originalName: file.originalname, mimeType: file.mimetype, size: file.size }, select });
    await recordActivity(tx, projectId, userId, 'ATTACHMENT_CREATED', attachment.id, { taskId });
    await notifyMembers(tx, projectId, userId, [{ taskId, userId: task.assigneeId, type: 'ATTACHMENT_ADDED', metadata: { attachmentId: attachment.id } }]);
    return attachment;
  });
}

/** List bounded public metadata without exposing storage keys or filesystem paths. */
export function listAttachments(projectId: string, userId: string, taskId: string, query: z.infer<typeof attachmentQuery>) {
  return inProject(projectId, userId, async tx => {
    await requireTask(tx, projectId, taskId);
    const where = { taskId };
    const items = await tx.attachment.findMany({ where, select, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], ...pageArgs(query.page, query.limit) });
    return { items, total: await tx.attachment.count({ where }), ...query };
  }, { mode: 'read' });
}

/** Open the file while membership and task access remain locked, then stream that handle. */
export async function downloadAttachment(projectId: string, userId: string, taskId: string, attachmentId: string) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    return await inProject(projectId, userId, async tx => {
      await requireTask(tx, projectId, taskId);
      const attachment = await tx.attachment.findFirst({ where: { id: attachmentId, taskId } });
      if (!attachment) throw new ApiError(404, 'NOT_FOUND', 'Attachment not found');
      try { handle = await open(storagePath(attachment.storageKey), 'r'); }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') throw new ApiError(404, 'NOT_FOUND', 'Attachment file not found');
        throw error;
      }
      return { attachment, handle };
    }, { mode: 'read' });
  } catch (error) { await handle?.close(); throw error; }
}

/** Remove metadata and enqueue physical deletion atomically for the uploader or owner. */
export function deleteAttachment(projectId: string, userId: string, taskId: string, attachmentId: string) {
  return inProject(projectId, userId, async (tx, project) => {
    const task = await requireTask(tx, projectId, taskId);
    const attachment = await tx.attachment.findFirst({ where: { id: attachmentId, taskId } });
    if (!attachment) throw new ApiError(404, 'NOT_FOUND', 'Attachment not found');
    if (attachment.uploaderId !== userId && project.ownerId !== userId) throw new ApiError(403, 'FORBIDDEN', 'Attachment uploader or project owner required');
    await tx.fileCleanup.create({ data: { storageKey: attachment.storageKey } });
    await tx.attachment.delete({ where: { id: attachmentId } });
    await recordActivity(tx, projectId, userId, 'ATTACHMENT_DELETED', attachmentId, { taskId });
    await notifyMembers(tx, projectId, userId, [{ taskId, userId: task.assigneeId, type: 'ATTACHMENT_DELETED', metadata: { attachmentId } }]);
  });
}
