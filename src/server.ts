import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { drainRecoveryJobs } from './auth/recovery.js';
import { startAuthCleanup } from './auth/cleanup.js';
import { startFileCleanup } from './attachments/cleanup.js';
import { closeNotificationStreams } from './notifications/stream.js';
import { logOperation } from './logging.js';
import { createShutdown } from './shutdown.js';

const server = app.listen(config.PORT, () => { logOperation('info', 'api.started', { port: config.PORT }); });
const stopCleanup = startAuthCleanup(() => { logOperation('error', 'cleanup.retry', { job: 'authentication' }); });
const stopFiles = startFileCleanup(() => { logOperation('error', 'cleanup.retry', { job: 'attachments' }); });
const shutdown = createShutdown({
  closeStreams: closeNotificationStreams,
  stopHttp: () => new Promise<void>((resolve, reject) => { server.close(error => { if (error) reject(error); else resolve(); }); }),
  stopJobs: [stopCleanup, stopFiles, drainRecoveryJobs],
  disconnect: () => db.$disconnect(),
  forceClose: () => { server.closeAllConnections(); },
  reportFailure: error => { logOperation('error', 'shutdown.failed', { error }); },
  exit: code => { process.exit(code); },
});
/** Stop accepting work and drain active resources on either supported termination signal. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { void shutdown(); });
}
