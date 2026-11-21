import { afterEach, describe, expect, it, vi } from 'vitest';
import { createShutdown } from '../src/shutdown.js';
import { logOperation } from '../src/logging.js';

/** Keep real timers and console methods isolated across shutdown scenarios. */
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('bounded shutdown', () => {
  it('drains once and disconnects after HTTP and jobs settle', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const disconnect = vi.fn(async () => {});
    const exit = vi.fn();
    const stopHttp = vi.fn(() => blocked);
    const shutdown = createShutdown({ closeStreams: vi.fn(), stopHttp, stopJobs: [async () => {}], disconnect, forceClose: vi.fn(), reportFailure: vi.fn(), exit });
    const first = shutdown();
    expect(shutdown()).toBe(first);
    await Promise.resolve();
    expect(disconnect).not.toHaveBeenCalled();
    release();
    await first;
    expect(stopHttp).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });
  it('reports job and disconnect failures without leaving rejected promises', async () => {
    const reportFailure = vi.fn();
    const exit = vi.fn();
    const disconnect = vi.fn(async () => { throw new Error('database'); });
    await createShutdown({ closeStreams: vi.fn(), stopHttp: async () => {}, stopJobs: [async () => { throw new Error('job'); }], disconnect, forceClose: vi.fn(), reportFailure, exit })();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenCalledWith(1);
  });
  it('forces termination when an HTTP connection cannot drain', async () => {
    vi.useFakeTimers();
    const forceClose = vi.fn();
    const exit = vi.fn();
    void createShutdown({ closeStreams: vi.fn(), stopHttp: () => new Promise(() => {}), stopJobs: [], disconnect: async () => {}, forceClose, reportFailure: vi.fn(), exit, deadlineMs: 100 })();
    await vi.advanceTimersByTimeAsync(100);
    expect(forceClose).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(1);
  });
  it('omits secret-bearing error messages and unapproved fields from operational logs', () => {
    const output = vi.spyOn(console, 'error').mockImplementation(() => {});
    logOperation('error', 'cleanup.retry', { job: 'attachments', error: new Error('GEMINI_API_KEY=private-value') });
    const record = JSON.parse(output.mock.calls[0][0]);
    expect(record).toMatchObject({ event: 'cleanup.retry', job: 'attachments', errorType: 'Error' });
    expect(JSON.stringify(record)).not.toContain('private-value');
  });
});
