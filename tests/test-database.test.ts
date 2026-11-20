import { describe, it, expect } from 'vitest';
import { testDatabaseUrl } from '../scripts/test-database.js';

describe('test database isolation', () => {
  it('requires an explicit test database', () => {
    expect(() => testDatabaseUrl(undefined)).toThrow('TEST_DATABASE_URL');
    expect(() => testDatabaseUrl('postgresql://localhost/task_management_dev')).toThrow('ends in _test');
    expect(() => testDatabaseUrl('https://localhost/task_management_test')).toThrow();
    expect(testDatabaseUrl('postgresql://localhost/task_management_test')).toContain('_test');
  });
});
