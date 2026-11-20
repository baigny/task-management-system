import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { drainRecoveryJobs } from './auth/recovery.js';
import { startAuthCleanup } from './auth/cleanup.js';

const server = app.listen(config.PORT, () => { console.info(`API listening on port ${config.PORT}`); });
const stopCleanup = startAuthCleanup(() => { console.error('Authentication cleanup failed; retrying next interval'); });
let shuttingDown = false;
/** Allow in-flight requests to finish, with a bounded shutdown deadline. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => { void Promise.all([stopCleanup(), drainRecoveryJobs()]).then(() => db.$disconnect()).then(() => process.exit(0)); });
    setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000).unref();
  });
}
