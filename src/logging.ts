type LogFields = { job?: string; port?: number; error?: unknown };

/** Emit operational JSON with allowlisted fields; never serialize error messages, stacks, or payloads. */
export function logOperation(level: 'info' | 'error', event: string, fields: LogFields = {}) {
  const record = {
    time: new Date().toISOString(), level, event,
    ...(fields.job ? { job: fields.job } : {}),
    ...(fields.port !== undefined ? { port: fields.port } : {}),
    ...(fields.error !== undefined ? { errorType: fields.error instanceof Error ? 'Error' : 'UnknownError' } : {}),
  };
  console[level](JSON.stringify(record));
}
