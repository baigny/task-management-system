import type { Request, Response } from 'express';

const DRAIN_TIMEOUT_MS = 5000;

/** Own HTTP stream disposal and bounded backpressure independently of notification replay. */
export function createStreamTransport(req: Request, res: Response, dispose: () => void) {
  let closed = false;

  /** Release response listeners and application resources exactly once. */
  function close(destroy = false) {
    if (closed) return;
    closed = true;
    req.off('aborted', onClosed);
    res.off('close', onClosed);
    res.off('error', onClosed);
    dispose();
    if (destroy) res.destroy(); else res.end();
  }

  /** A broken transport must never receive further writes. */
  function onClosed() { close(true); }

  /** Disconnect clients that cannot drain one frame within the bounded write deadline. */
  async function send(frame: string) {
    if (closed || res.destroyed) return false;
    if (!res.write(frame)) {
      await new Promise<void>(resolve => {
        /** Remove temporary listeners on either recovery or disconnect. */
        function done() { clearTimeout(deadline); res.off('drain', done); res.off('close', done); resolve(); }
        const deadline = setTimeout(() => { close(true); done(); }, DRAIN_TIMEOUT_MS);
        deadline.unref();
        res.once('drain', done);
        res.once('close', done);
      });
    }
    return !closed;
  }

  req.on('aborted', onClosed);
  res.on('close', onClosed);
  res.on('error', onClosed);
  return { close, send, get closed() { return closed; } };
}
