import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';
import { db } from '../db.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { accountKey, takeAccountAttempt } from './throttle.js';

export const publicUser = { id: true, email: true, name: true, createdAt: true } as const;
const hashingOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;
/** Hash a password with explicit Argon2id memory, time, and parallelism settings. */
export const hashPassword = (password: string) => argon2.hash(password, hashingOptions);

/** Persist a one-hour session so logout revokes a signed bearer token immediately. */
export async function createSession(user: { id: string }, client: Prisma.TransactionClient = db) {
  const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + 60 * 60 * 1000);
  const session = await client.session.create({ data: { userId: user.id, expiresAt } });
  const token = jwt.sign({ sub: user.id, sid: session.id }, config.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: '1h', issuer: 'task-management', audience: 'task-api',
  });
  return { token, expiresAt };
}
/** Atomically create an account and its first session; persist only the password hash. */
export async function register(input: { email: string; name: string; password: string }) {
  const passwordHash = await hashPassword(input.password);
  return db.$transaction(async tx => {
    const user = await tx.user.create({ data: { email: input.email, name: input.name, passwordHash }, select: publicUser });
    return { user, ...await createSession(user, tx) };
  });
}

// Unknown emails still perform password verification to reduce account-enumeration timing differences.
const dummyHash = hashPassword('unused-authentication-timing-value');
/** Verify credentials under an account cooldown and return a public profile and session. */
export async function login(input: { email: string; password: string }) {
  await takeAccountAttempt('login', input.email, 5);
  const user = await db.user.findUnique({ where: { email: input.email } });
  const valid = await argon2.verify(user?.passwordHash ?? await dummyHash, input.password);
  if (!user || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  // Locking this user also coordinates session creation with later password changes/resets.
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (current.passwordHash !== user.passwordHash) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    await tx.authAttempt.deleteMany({ where: { key: accountKey('login', input.email) } });
    const profile = { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
    return { user: profile, ...await createSession(user, tx) };
  });
}

/** Fetch the account's allowlisted profile fields, excluding its password hash. */
export function readProfile(userId: string) {
  return db.user.findUniqueOrThrow({ where: { id: userId }, select: publicUser });
}

/** Change only the validated display name for the authenticated account. */
export function updateProfile(userId: string, input: { name: string }) {
  return db.user.update({ where: { id: userId }, data: input, select: publicUser });
}

/** Revoke a single device session without affecting the account's other sessions. */
export function revokeSession(sessionId: string) {
  return db.session.deleteMany({ where: { id: sessionId } });
}

/** Serialize account-wide revocation with session creation to avoid partial logout. */
export function revokeAllSessions(userId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    await tx.session.deleteMany({ where: { userId } });
  });
}
