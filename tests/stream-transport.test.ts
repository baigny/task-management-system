import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamTransport } from '../src/notifications/transport.js';

/** Simulate a stalled socket without relying on OS send-buffer sizes. */
function stalledConnection() {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    destroyed: false, write: vi.fn(() => false),
    end: vi.fn(() => { res.emit('close'); }),
    destroy: vi.fn(() => { res.destroyed = true; res.emit('close'); }),
  });
  const dispose = vi.fn();
  const transport = createStreamTransport(req as Request, res as unknown as Response, dispose);
  return { req, res, dispose, transport };
}

afterEach(() => { vi.useRealTimers(); });
describe('SSE backpressure', () => {
  it('resumes after drain and releases all resources exactly once on abort', async () => {
    const { req, res, dispose, transport } = stalledConnection();
    const pending = transport.send('frame');
    res.emit('drain');
    expect(await pending).toBe(true);
    expect(res.listenerCount('drain')).toBe(0);
    req.emit('aborted');
    transport.close();
    expect(dispose).toHaveBeenCalledOnce();
    expect(await transport.send('late')).toBe(false);
    expect(res.write).toHaveBeenCalledOnce();
  });
  it('destroys a stalled socket at the deadline and clears temporary listeners', async () => {
    vi.useFakeTimers();
    const { res, dispose, transport } = stalledConnection();
    const pending = transport.send('frame');
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(false);
    expect(res.destroy).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(res.listenerCount('drain')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
  });
});
