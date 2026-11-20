/** Never fall back to the development database for integration tests or migrations. */
export function testDatabaseUrl(input: string | undefined): string {
  if (!input) throw new Error('TEST_DATABASE_URL is required');
  const url = new URL(input);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !decodeURIComponent(url.pathname).endsWith('_test')) {
    throw new Error('Integration tests require a PostgreSQL database whose name ends in _test');
  }
  return input;
}
