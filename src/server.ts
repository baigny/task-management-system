import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { drainRecoveryJobs } from './auth/recovery.js';
import { startAuthCleanup } from './auth/cleanup.js';
import { startFileCleanup } from './attachments/cleanup.js';
import { closeNotificationStreams } from './notifications/stream.js';

const server = app.listen(config.PORT, () => { console.info(`API listening on port ${config.PORT}`); });
const stopCleanup = startAuthCleanup(() => { console.error('Authentication cleanup failed; retrying next interval'); });
const stopFiles = startFileCleanup(() => { console.error('File cleanup failed; retrying queued deletion'); });
let shuttingDown = false;
/** Allow in-flight requests to finish, with a bounded shutdown deadline. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    closeNotificationStreams();
    server.close(() => { void Promise.all([stopCleanup(), stopFiles(), drainRecoveryJobs()]).then(() => db.$disconnect()).then(() => process.exit(0)); });
    setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000).unref();
  });
}
