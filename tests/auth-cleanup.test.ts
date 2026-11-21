import { afterEach, describe, expect, it, vi } from 'vitest';

const execute = vi.hoisted(() => vi.fn());
vi.mock('../src/db.js', () => ({ db: { $executeRaw: execute } }));
import { startAuthCleanup } from '../src/auth/cleanup.js';

afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

describe('authentication cleanup scheduling', () => {
  it('prevents overlapping runs and drains the active batch before stopping', async () => {
    vi.useFakeTimers();
    let release!: (value: number) => void;
    execute.mockReturnValueOnce(new Promise<number>(resolve => { release = resolve; })).mockResolvedValue(0);
    const stop = startAuthCleanup(vi.fn());
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(execute).toHaveBeenCalledTimes(1);
    let stopped = false;
    const draining = stop().then(() => { stopped = true; });
    expect(stopped).toBe(false);
    release(0);
    await draining;
    expect(execute).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(execute).toHaveBeenCalledTimes(3);
  });
  it('reports failures and retries at the next interval', async () => {
    vi.useFakeTimers();
    execute.mockRejectedValueOnce(new Error('Database unavailable')).mockResolvedValue(0);
    const failed = vi.fn();
    const stop = startAuthCleanup(failed);
    await vi.advanceTimersByTimeAsync(0);
    expect(failed).toHaveBeenCalledExactlyOnceWith();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    expect(execute).toHaveBeenCalledTimes(4);
    await stop();
  });
});
