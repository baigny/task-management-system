import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { drainRecoveryJobs } from './auth/recovery.js';

const server = app.listen(config.PORT, () => { console.info(`API listening on port ${config.PORT}`); });
/** Allow in-flight requests to finish, with a bounded shutdown deadline. */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => { void drainRecoveryJobs().then(() => db.$disconnect()).then(() => process.exit(0)); });
    setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000).unref();
  });
}
