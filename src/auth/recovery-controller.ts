import { getAuth } from './middleware.js';
import type { Request, Response } from 'express';
import { forgotInput, resetInput, changeInput } from './validation.js';
import { assertRecoveryAvailable, enqueuePasswordReset, resetPassword, changePassword } from './recovery.js';
import { takeAccountAttempt } from './throttle.js';

/** Respond identically for known/unknown emails and never expose a recovery token. */
export async function forgotPassword(req: Request, res: Response) {
  const input = forgotInput.parse(req.body);
  assertRecoveryAvailable();
  await takeAccountAttempt('forgot-password', input.email, 5);
  enqueuePasswordReset(input.email, () => { req.log.error('Password recovery delivery failed'); });
  res.status(202).json({ message: 'If an account exists for this email, password reset instructions will be sent.' });
}

/** Validate a one-time recovery token and confirmation, then require a fresh login. */
export async function resetUserPassword(req: Request, res: Response) {
  await resetPassword(resetInput.parse(req.body));
  res.sendStatus(204);
}

/** Change a logged-in account's password and revoke every device session. */
export async function changeUserPassword(req: Request, res: Response) {
  const { userId, sessionId } = getAuth(req);
  await changePassword(userId, sessionId, changeInput.parse(req.body));
  res.sendStatus(204);
}
