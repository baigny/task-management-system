import type { Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { getAuth } from '../auth/middleware.js';
import { watchRevocation } from '../auth/revocation.js';
import { ApiError } from '../errors.js';
import { notificationInclude, presentNotification, visibleNotifications } from './service.js';

const cursorInput = z.string().regex(/^\d{1,10}$/).transform(Number).pipe(z.number().int().min(0).max(2147483647));
const connections = new Set<{ userId: string; close: () => void }>();

/** End all long-lived connections before HTTP shutdown begins draining ordinary requests. */
export function closeNotificationStreams() { for (const connection of connections) connection.close(); }

/** Replay persisted, authorized notices and poll committed changes with bounded connection resources. */
export async function streamNotifications(req: Request, res: Response) {
  z.object({}).strict().parse(req.query);
  const auth = getAuth(req);
  const header = req.get('Last-Event-ID');
  let cursor = header ? cursorInput.parse(header) : 0;
  if (connections.size >= 200 || [...connections].filter(connection => connection.userId === auth.userId).length >= 5) {
    throw new ApiError(429, 'STREAM_LIMIT', 'Too many notification streams', 3);
  }
  let closed = false;
  let polling = false;
  // A disconnect may occur before startup has installed every timer/subscription.
  let pollTimer: ReturnType<typeof setInterval> | undefined = undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined = undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  let unsubscribe: (() => void) | undefined = undefined;
  const connection = { userId: auth.userId, close: () => { close(); } };

  /** Release timers/subscriptions exactly once; destroy slow clients rather than buffering indefinitely. */
  function close(destroy = false) {
    if (closed) return;
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    clearTimeout(expiryTimer);
    unsubscribe?.();
    connections.delete(connection);
    req.off('aborted', onAborted);
    res.off('close', onClosed);
    res.off('error', onClosed);
    if (destroy) res.destroy(); else res.end();
  }
  /** Dispose of a client-aborted request without attempting further writes. */
  function onAborted() { close(true); }
  /** Release server resources when the response closes or encounters a transport error. */
  function onClosed() { close(true); }
  /** Honor transport backpressure, disconnecting only if a blocked write cannot drain within five seconds. */
  async function send(frame: string) {
    if (closed || res.destroyed) return false;
    if (!res.write(frame)) {
      await new Promise<void>(resolve => {
        /** Clear temporary drain listeners on either recovery or disconnect. */
        function done() { clearTimeout(deadline); res.off('drain', done); res.off('close', done); resolve(); }
        const deadline = setTimeout(() => { close(true); done(); }, 5000);
        deadline.unref();
        res.once('drain', done);
        res.once('close', done);
      });
    }
    return !closed;
  }
  /** Revalidate the session before every replay batch; external revocations are caught by polling. */
  async function poll() {
    if (closed || polling) return;
    polling = true;
    try {
      const session = await db.session.findUnique({ where: { id: auth.sessionId }, select: { userId: true, expiresAt: true } });
      if (closed) return;
      if (!session || session.userId !== auth.userId || session.expiresAt <= new Date() || auth.expiresAt <= new Date()) { close(); return; }
      const notices = await db.notification.findMany({ where: { ...visibleNotifications(auth.userId), id: { gt: cursor } }, include: notificationInclude, orderBy: { id: 'asc' }, take: 100 });
      for (const notice of notices) {
        if (closed || auth.expiresAt <= new Date()) { close(); return; }
        if (!await send(`id: ${notice.id}\nevent: notification\ndata: ${JSON.stringify(presentNotification(notice))}\n\n`)) return;
        cursor = notice.id;
      }
    } catch {
      if (!closed) { req.log.error('Notification stream database check failed'); await send('event: stream-error\ndata: {"code":"STREAM_UNAVAILABLE"}\n\n'); close(); }
    } finally { polling = false; }
  }

  connections.add(connection);
  unsubscribe = watchRevocation(auth, () => { close(); });
  req.on('aborted', onAborted);
  res.on('close', onClosed);
  res.on('error', onClosed);
  res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  if (!await send(': connected\nretry: 3000\n\n') || closed) return;
  expiryTimer = setTimeout(() => { close(); }, Math.max(0, auth.expiresAt.getTime() - Date.now()));
  expiryTimer.unref();
  pollTimer = setInterval(() => { void poll(); }, 2000);
  pollTimer.unref();
  heartbeatTimer = setInterval(() => { void send(': heartbeat\n\n'); }, 15000);
  heartbeatTimer.unref();
  await poll();
}
