import type { Request, Response } from 'express';
import { id, pagination } from '../validation.js';
import { invitationInput, acceptanceInput } from './validation.js';
import * as invitations from './service.js';

/** Validate the recipient and return a shareable invitation secret only at issuance. */
export async function inviteMember(req: Request, res: Response) {
  const { email } = invitationInput.parse(req.body);
  res.status(201).json(await invitations.inviteMember(id.parse(req.params.projectId), req.auth.userId, email));
}

/** Validate pagination before listing owner-visible invitation records. */
export async function listInvitations(req: Request, res: Response) {
  const { page, limit } = pagination.parse(req.query);
  res.json(await invitations.listInvitations(id.parse(req.params.projectId), req.auth.userId, page, limit));
}

/** Revoke an invitation identified within the authorized project. */
export async function revokeInvitation(req: Request, res: Response) {
  await invitations.revokeInvitation(id.parse(req.params.projectId), req.auth.userId, id.parse(req.params.invitationId));
  res.sendStatus(204);
}

/** Accept a validated token using the account authenticated by the bearer session. */
export async function acceptInvitation(req: Request, res: Response) {
  res.json(await invitations.acceptInvitation(req.auth.userId, acceptanceInput.parse(req.body).token));
}
