import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { testDatabaseUrl } from './test-database.js';

const env = { ...process.env, NODE_ENV: 'test', DATABASE_URL: testDatabaseUrl(process.env.TEST_DATABASE_URL) };
// Use Node entrypoints across platforms; forward filters only to Vitest, never to Prisma.
for (const args of [
  ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts', ...process.argv.slice(2)],
]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
