import { getAuth } from './middleware.js';
import type { Request, Response } from 'express';
import { login, register, readProfile, updateProfile, revokeSession, revokeAllSessions } from './service.js';
import { registration, credentials, profileUpdate } from './validation.js';

/** Validate registration and confirmation, then return a new public account and token. */
export async function registerUser(req: Request, res: Response) {
  res.status(201).json(await register(registration.parse(req.body)));
}

/** Validate credentials and issue a bearer token without exposing password data. */
export async function loginUser(req: Request, res: Response) {
  res.json(await login(credentials.parse(req.body)));
}

/** Return the authenticated account's public profile. */
export async function getProfile(req: Request, res: Response) {
  res.json(await readProfile(getAuth(req).userId));
}

/** Validate the display name and reject protected or unknown profile fields. */
export async function updateUserProfile(req: Request, res: Response) {
  res.json(await updateProfile(getAuth(req).userId, profileUpdate.parse(req.body)));
}

/** Revoke the authenticated device token and return an empty success response. */
export async function logoutUser(req: Request, res: Response) {
  await revokeSession(getAuth(req).sessionId);
  res.sendStatus(204);
}

/** Revoke every device token belonging to the authenticated account. */
export async function logoutAllDevices(req: Request, res: Response) {
  await revokeAllSessions(getAuth(req).userId);
  res.sendStatus(204);
}
