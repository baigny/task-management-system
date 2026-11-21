import { createHash } from 'node:crypto';
import { db } from '../db.js';
import { ApiError } from '../errors.js';

/** Identify an operation/account pair without storing an email in the throttle table. */
export const accountKey = (scope: string, email: string) => createHash('sha256').update(`${scope}:${email}`).digest('hex');

/** Atomic fixed windows survive restarts and cannot be bypassed with concurrent attempts. */
export async function takeAccountAttempt(scope: string, email: string, limit: number) {
  const key = accountKey(scope, email);
  const now = new Date();
  const cutoff = new Date(now.getTime() - 15 * 60 * 1000);
  const [attempt] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "AuthAttempt" ("key", "count", "windowStartedAt") VALUES (${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AuthAttempt"."windowStartedAt" <= ${cutoff} THEN 1 ELSE "AuthAttempt"."count" + 1 END,
      "windowStartedAt" = CASE WHEN "AuthAttempt"."windowStartedAt" <= ${cutoff} THEN ${now} ELSE "AuthAttempt"."windowStartedAt" END
    RETURNING "count"`;
  if (attempt.count > limit) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts; try again later', 900);
}
