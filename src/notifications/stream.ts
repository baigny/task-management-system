import type { Request, Response } from 'express';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import { watchRevocation } from '../auth/revocation.js';
import { ApiError } from '../errors.js';
import { presentNotification } from './service.js';
import { readReplayBatch } from './replay.js';
import { createStreamTransport } from './transport.js';

const cursorInput = z.string().regex(/^\d{1,10}$/).transform(Number).pipe(z.number().int().min(0).max(2147483647));
const connections = new Set<{ userId: string; close: () => void }>();
const MAX_CONNECTIONS = 200;
const MAX_USER_CONNECTIONS = 5;
const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 15_000;

/** End all long-lived connections before HTTP shutdown begins draining ordinary requests. */
export function closeNotificationStreams() { for (const connection of connections) connection.close(); }

/** Replay persisted, authorized notices and poll committed changes with bounded connection resources. */
export async function streamNotifications(req: Request, res: Response) {
  z.object({}).strict().parse(req.query);
  const auth = getAuth(req);
  const header = req.get('Last-Event-ID');
  let cursor = header ? cursorInput.parse(header) : 0;
  if (connections.size >= MAX_CONNECTIONS || [...connections].filter(connection => connection.userId === auth.userId).length >= MAX_USER_CONNECTIONS) {
    throw new ApiError(429, 'STREAM_LIMIT', 'Too many notification streams', 3);
  }
  let polling = false;
  // A disconnect may occur before startup has installed every timer/subscription.
  let pollTimer: ReturnType<typeof setInterval> | undefined = undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined = undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let unsubscribe: (() => void) | undefined = undefined;
  const transport = createStreamTransport(req, res, () => {
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    clearTimeout(expiryTimer);
    unsubscribe?.();
    connections.delete(connection);
  });
  const { close, send } = transport;
  const connection = { userId: auth.userId, close };
  /** Revalidate the session before every replay batch; external revocations are caught by polling. */
  async function poll() {
    if (transport.closed || polling) return;
    polling = true;
    try {
      const notices = await readReplayBatch(auth, cursor);
      if (transport.closed) return;
      if (!notices) { close(); return; }
      for (const notice of notices) {
        if (transport.closed || auth.expiresAt <= new Date()) { close(); return; }
        if (!await send(`id: ${notice.id}\nevent: notification\ndata: ${JSON.stringify(presentNotification(notice))}\n\n`)) return;
        cursor = notice.id;
      }
    } catch {
      if (!transport.closed) { req.log.error('Notification stream database check failed'); await send('event: stream-error\ndata: {"code":"STREAM_UNAVAILABLE"}\n\n'); close(); }
    } finally { polling = false; }
  }

  connections.add(connection);
  unsubscribe = watchRevocation(auth, () => { close(); });
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  if (!await send(': connected\nretry: 3000\n\n') || transport.closed) return;
  expiryTimer = setTimeout(() => { close(); }, Math.max(0, auth.expiresAt.getTime() - Date.now()));
  expiryTimer.unref();
  pollTimer = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
  pollTimer.unref();
  heartbeatTimer = setInterval(() => { void send(': heartbeat\n\n'); }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
  await poll();
}
