import { describe, expect, it } from 'vitest';
import { parseEnvironment } from '../src/config.js';

const valid = { DATABASE_URL: 'postgresql://taskapp:taskapp@localhost:5432/task_management_dev', JWT_SECRET: 'a'.repeat(64) };
describe('environment validation', () => {
  it('applies local defaults', () => {
    expect(parseEnvironment(valid)).toMatchObject({ PORT: 3000, NODE_ENV: 'development' });
  });
  it('rejects missing, short, and inappropriate values', () => {
    expect(() => parseEnvironment({})).toThrow();
    expect(() => parseEnvironment({ ...valid, JWT_SECRET: 'short' })).toThrow();
    expect(() => parseEnvironment({ ...valid, DATABASE_URL: 'https://example.com' })).toThrow();
    expect(() => parseEnvironment({ ...valid, PORT: 70000 })).toThrow();
    expect(() => parseEnvironment({ ...valid, CORS_ORIGIN: '*' })).toThrow();
  });
  it('rejects the example secret in production', () => {
    expect(() => parseEnvironment({ ...valid, NODE_ENV: 'production', JWT_SECRET: 'replace-with-at-least-32-random-characters' })).toThrow();
    expect(parseEnvironment({ ...valid, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });
});
