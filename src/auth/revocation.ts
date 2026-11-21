import type { AuthContext } from './types.js';

const watchers = new Set<{ userId: string; sessionId: string; close: () => void }>();

/** Subscribe a live connection to committed local session revocations. */
export function watchRevocation(auth: AuthContext, close: () => void) {
  const watcher = { userId: auth.userId, sessionId: auth.sessionId, close };
  watchers.add(watcher);
  return () => { watchers.delete(watcher); };
}

/** Close streams for one session only after its database revocation succeeds. */
export function notifySessionRevoked(sessionId: string) {
  for (const watcher of watchers) if (watcher.sessionId === sessionId) watcher.close();
}

/** Close all account streams after logout-all or a committed password change/reset. */
export function notifyUserRevoked(userId: string) {
  for (const watcher of watchers) if (watcher.userId === userId) watcher.close();
}
