import type { Request, Response } from 'express';
import { login, register } from './service.js';
import { registration, credentials } from './validation.js';

/** Validate registration and confirmation, then return a new public account and token. */
export async function registerUser(req: Request, res: Response) {
  res.status(201).json(await register(registration.parse(req.body)));
}

/** Validate credentials and issue a bearer token without exposing password data. */
export async function loginUser(req: Request, res: Response) {
  res.json(await login(credentials.parse(req.body)));
}
