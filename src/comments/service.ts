import { inProject } from '../access.js';
import { recordActivity } from '../activity.js';
import { publicUser } from '../auth/types.js';
import { ApiError } from '../errors.js';
import { requireTask } from '../tasks/access.js';
import { pageArgs } from '../validation.js';
import type { CommentInput, CommentQuery } from './validation.js';

const include = { author: { select: publicUser }, _count: { select: { replies: true } } } as const;

/** Create a thread or a direct reply to a root comment on the same accessible task. */
export function createComment(projectId: string, userId: string, taskId: string, input: CommentInput) {
  return inProject(projectId, userId, async tx => {
    await requireTask(tx, projectId, taskId);
    if (input.parentId) {
      const parent = await tx.comment.findFirst({ where: { id: input.parentId, taskId } });
      if (!parent) throw new ApiError(404, 'NOT_FOUND', 'Comment thread not found');
      if (parent.parentId) throw new ApiError(400, 'INVALID_PARENT', 'Reply to the thread root');
    }
    const comment = await tx.comment.create({ data: { taskId, authorId: userId, ...input }, include });
    await recordActivity(tx, projectId, userId, 'COMMENT_CREATED', comment.id, { taskId, parentId: comment.parentId });
    return comment;
  });
}

/** Page thread roots or a root's replies in stable chronological order without loading entire trees. */
export function listComments(projectId: string, userId: string, taskId: string, query: CommentQuery, parentId: string | null = null) {
  return inProject(projectId, userId, async tx => {
    await requireTask(tx, projectId, taskId);
    if (parentId) {
      const root = await tx.comment.findFirst({ where: { id: parentId, taskId, parentId: null } });
      if (!root) throw new ApiError(404, 'NOT_FOUND', 'Comment thread not found');
    }
    const where = { taskId, parentId };
    const items = await tx.comment.findMany({ where, include, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], ...pageArgs(query.page, query.limit) });
    return { items, total: await tx.comment.count({ where }), ...query };
  }, { mode: 'read' });
}

/** Remove only the author's or owner's text while keeping thread structure and existing replies. */
export function deleteComment(projectId: string, userId: string, taskId: string, commentId: string) {
  return inProject(projectId, userId, async (tx, project) => {
    await requireTask(tx, projectId, taskId);
    const comment = await tx.comment.findFirst({ where: { id: commentId, taskId } });
    if (!comment) throw new ApiError(404, 'NOT_FOUND', 'Comment not found');
    if (comment.authorId !== userId && project.ownerId !== userId) throw new ApiError(403, 'FORBIDDEN', 'Comment author or project owner required');
    if (comment.deletedAt) return;
    await tx.comment.update({ where: { id: commentId }, data: { body: null, deletedAt: new Date() } });
    await recordActivity(tx, projectId, userId, 'COMMENT_DELETED', commentId, { taskId });
  });
}
