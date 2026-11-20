import type { Request, Response } from 'express';
import { getAuth } from '../auth/middleware.js';
import { id } from '../validation.js';
import { commentInput, commentQuery } from './validation.js';
import * as comments from './service.js';

/** Validate the comment text and optional thread root before creation. */
export async function createComment(req: Request, res: Response) {
  res.status(201).json(await comments.createComment(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId), commentInput.parse(req.body)));
}

/** Return paginated root comments for the member-visible task. */
export async function listComments(req: Request, res: Response) {
  res.json(await comments.listComments(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId), commentQuery.parse(req.query)));
}

/** Return a separately paginated reply list bound to its task and root. */
export async function listReplies(req: Request, res: Response) {
  res.json(await comments.listComments(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId), commentQuery.parse(req.query), id.parse(req.params.commentId)));
}

/** Authorize comment removal and return an empty success response. */
export async function deleteComment(req: Request, res: Response) {
  await comments.deleteComment(id.parse(req.params.projectId), getAuth(req).userId, id.parse(req.params.taskId), id.parse(req.params.commentId));
  res.sendStatus(204);
}
