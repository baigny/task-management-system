import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/config.test.ts'], env: { NODE_ENV: 'test' }, fileParallelism: false } });
