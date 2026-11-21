type ShutdownOptions = {
  closeStreams: () => void;
  stopHttp: () => Promise<void>;
  stopJobs: (() => Promise<void>)[];
  disconnect: () => Promise<void>;
  forceClose: () => void;
  reportFailure: (error: unknown) => void;
  exit: (code: number) => void;
  deadlineMs?: number;
};

/** Drain once, report failures, and disconnect even when a job fails, subject to one hard deadline. */
export function createShutdown(options: ShutdownOptions) {
  let pending: Promise<void> | undefined;
  return function shutdown(): Promise<void> {
    if (pending) return pending;
    const deadline = setTimeout(() => { options.forceClose(); options.exit(1); }, options.deadlineMs ?? 10_000);
    deadline.unref();
    pending = (async () => {
      let failed = false;
      try {
        options.closeStreams();
        // Stop new background work immediately while ordinary HTTP requests drain.
        const results = await Promise.allSettled([options.stopHttp, ...options.stopJobs].map(stop => Promise.resolve().then(stop)));
        for (const result of results) {
          if (result.status === 'rejected') { failed = true; options.reportFailure(result.reason); }
        }
      } catch (error) { failed = true; options.reportFailure(error); }
      try { await options.disconnect(); }
      catch (error) { failed = true; options.reportFailure(error); }
      finally { clearTimeout(deadline); options.exit(failed ? 1 : 0); }
    })();
    return pending;
  };
}
