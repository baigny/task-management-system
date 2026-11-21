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
  it('parses SMTP flags explicitly and requires paired credentials', () => {
    expect(parseEnvironment({ ...valid, SMTP_SECURE: 'false' }).SMTP_SECURE).toBe(false);
    expect(parseEnvironment({ ...valid, SMTP_SECURE: 'true' }).SMTP_SECURE).toBe(true);
    expect(() => parseEnvironment({ ...valid, SMTP_USER: 'sender', SMTP_PASSWORD: '' })).toThrow();
    expect(() => parseEnvironment({ ...valid, SMTP_PORT: 70000 })).toThrow();
  });
  it('allows disabled Gemini but validates its model and bounded timeout', () => {
    expect(parseEnvironment(valid)).toMatchObject({ GEMINI_API_KEY: '', GEMINI_MODEL: 'gemini-3.5-flash-lite', GEMINI_TIMEOUT_MS: 15000 });
    expect(() => parseEnvironment({ ...valid, GEMINI_MODEL: '' })).toThrow();
    expect(() => parseEnvironment({ ...valid, GEMINI_MODEL: 'https://other-provider' })).toThrow();
    expect(() => parseEnvironment({ ...valid, GEMINI_TIMEOUT_MS: 0 })).toThrow();
    expect(() => parseEnvironment({ ...valid, GEMINI_TIMEOUT_MS: 60001 })).toThrow();
  });
});
