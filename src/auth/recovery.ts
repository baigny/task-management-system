import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '../db.js';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import type { ResetPasswordData, ChangePasswordData } from './validation.js';
import { hashPassword } from './service.js';
import { accountKey, takeAccountAttempt } from './throttle.js';
import { sendResetEmail } from './mail.js';

const pending = new Set<Promise<void>>();

/** Hash high-entropy recovery tokens so a database leak cannot expose usable tokens. */
export const resetTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Reject unconfigured or saturated delivery before any account lookup occurs. */
export function assertRecoveryAvailable() {
  if (!config.SMTP_HOST) throw new ApiError(503, 'RECOVERY_UNAVAILABLE', 'Password recovery is not configured');
  if (pending.size >= 50) throw new ApiError(503, 'RECOVERY_UNAVAILABLE', 'Password recovery is temporarily unavailable');
}

/** Create a hashed, 15-minute token and deliver it outside the database transaction. */
async function issuePasswordReset(email: string, requestedAt: Date) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user) return;
  const token = randomBytes(32).toString('hex');
  const reset = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    // A queued request made before a password change must not create a fresh token afterward.
    if (current.passwordChangedAt && current.passwordChangedAt >= requestedAt) return null;
    return tx.passwordReset.create({ data: { userId: user.id, tokenHash: resetTokenHash(token), expiresAt: new Date(Date.now() + 15 * 60 * 1000) } });
  });
  if (!reset) return;
  try { await sendResetEmail(email, token); }
  catch (error) {
    await db.passwordReset.deleteMany({ where: { id: reset.id } });
    throw error;
  }
}

/** Defer lookup/delivery until after the generic response, avoiding account-disclosure timing. */
export function enqueuePasswordReset(email: string, onFailure: () => void) {
  assertRecoveryAvailable();
  const requestedAt = new Date();
  const job = new Promise<void>(resolve => setImmediate(resolve))
    .then(() => issuePasswordReset(email, requestedAt))
    .catch(() => { onFailure(); })
    .finally(() => { pending.delete(job); });
  pending.add(job);
}

/** Drain queued delivery before shutdown or before assertions in integration tests. */
export async function drainRecoveryJobs() { await Promise.allSettled([...pending]); }

/** Consume one reset token atomically, replace the password, and revoke all other access. */
export async function resetPassword(input: ResetPasswordData) {
  const found = await db.passwordReset.findUnique({ where: { tokenHash: resetTokenHash(input.token) } });
  if (!found || found.expiresAt <= new Date()) throw new ApiError(400, 'INVALID_RESET_TOKEN', 'Reset token is invalid or expired');
  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${found.userId} FOR UPDATE`;
    const reset = await tx.passwordReset.findUnique({ where: { id: found.id } });
    if (!reset || reset.expiresAt <= new Date()) throw new ApiError(400, 'INVALID_RESET_TOKEN', 'Reset token is invalid or expired');
    const user = await tx.user.update({ where: { id: found.userId }, data: { passwordHash, passwordChangedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.passwordReset.deleteMany({ where: { userId: user.id } });
    await tx.authAttempt.deleteMany({ where: { key: { in: [accountKey('login', user.email), accountKey('change-password', user.email)] } } });
  });
}

/** Require the current password and a still-valid session before changing credentials. */
export async function changePassword(userId: string, sessionId: string, input: ChangePasswordData) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  await takeAccountAttempt('change-password', user.email, 5);
  if (!await argon2.verify(user.passwordHash, input.currentPassword)) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid current password');
  const passwordHash = await hashPassword(input.password);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const session = await tx.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId || session.expiresAt <= new Date() || current.passwordHash !== user.passwordHash) {
      throw new ApiError(401, 'UNAUTHORIZED', 'Session expired or credentials changed');
    }
    await tx.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: new Date() } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.passwordReset.deleteMany({ where: { userId } });
    await tx.authAttempt.deleteMany({ where: { key: { in: [accountKey('login', user.email), accountKey('change-password', user.email)] } } });
  });
}
