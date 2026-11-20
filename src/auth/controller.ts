import type { Request, Response } from 'express';
import { z } from 'zod';
import { login, register, readProfile, updateProfile } from './service.js';
import { registration, credentials, name } from './validation.js';

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
  res.json(await readProfile(req.auth.userId));
}

/** Validate the display name and reject protected or unknown profile fields. */
export async function updateUserProfile(req: Request, res: Response) {
  res.json(await updateProfile(req.auth.userId, z.object({ name }).strict().parse(req.body)));
}
