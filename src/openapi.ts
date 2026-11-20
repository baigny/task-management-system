export type Schema = Record<string, unknown>;
export type Operation = {
  method: 'get' | 'post' | 'patch' | 'delete'; path: string; summary: string;
  description?: string; auth?: boolean; status?: number; errors?: number[];
  body?: string; example?: Record<string, unknown>; response?: string;
  requestContentType?: string; responseContentType?: string;
  query?: { name: string; schema: Schema; example?: string; description?: string }[];
  save?: { variable: string; path: string }[];
};
export const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
export const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
export const schemas: Record<string, Schema> = {
  Health: object({ status: { type: 'string', enum: ['ok'] } }),
  Readiness: object({ status: { type: 'string', enum: ['ready'] } }),
  Error: object({ error: object({ code: { type: 'string' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'object' } } }, ['code', 'message']) }),
  User: object({ id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, name: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } }),
  Password: { type: 'string', minLength: 12, maxLength: 128, writeOnly: true },
  Register: object({ email: { type: 'string', format: 'email', maxLength: 254 }, name: { type: 'string', minLength: 1, maxLength: 100 }, password: ref('Password'), confirmPassword: { allOf: [ref('Password')], description: 'Must match password; never stored.' } }),
  Login: object({ email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 1, maxLength: 128, writeOnly: true } }),
  AuthResult: object({ user: ref('User'), token: { type: 'string' }, expiresAt: { type: 'string', format: 'date-time' } }),
  ProfileUpdate: object({ name: { type: 'string', minLength: 1, maxLength: 100 } }),
};

// Both Swagger and Postman consume these operations, so examples change with each feature.
export const operations: Operation[] = [
  { method: 'get', path: '/health', summary: 'Process health', auth: false, response: 'Health', errors: [500], description: 'Checks the HTTP process independently of PostgreSQL.' },
  { method: 'get', path: '/ready', summary: 'Database readiness', auth: false, response: 'Readiness', errors: [503], description: 'Queries PostgreSQL. Returns DATABASE_UNAVAILABLE when the database cannot be reached.' },
  { method: 'post', path: '/api/v1/auth/register', summary: 'Register account', auth: false, status: 201, body: 'Register', response: 'AuthResult', example: { email: 'developer@example.com', name: 'Developer', password: 'strong-password-123', confirmPassword: 'strong-password-123' }, save: [{ variable: 'token', path: 'token' }, { variable: 'userId', path: 'user.id' }], description: 'Creates an account and one-hour session. Passwords must match. Duplicate email returns 409. Authentication responses are not cached.' },
  { method: 'post', path: '/api/v1/auth/login', summary: 'Login', auth: false, body: 'Login', response: 'AuthResult', example: { email: 'developer@example.com', password: 'strong-password-123' }, save: [{ variable: 'token', path: 'token' }, { variable: 'userId', path: 'user.id' }], description: 'Invalid email and password share one response. After five failed attempts per account in 15 minutes, further attempts return 429. Success resets the account counter.' },
  { method: 'get', path: '/api/v1/users/me', summary: 'View profile', response: 'User', description: 'Returns the authenticated account profile without credentials. Response is not cached.' },
  { method: 'patch', path: '/api/v1/users/me', summary: 'Update profile', body: 'ProfileUpdate', response: 'User', example: { name: 'Updated Developer' }, description: 'Changes only the display name. Unknown/protected fields are rejected.' },
  { method: 'post', path: '/api/v1/auth/logout', summary: 'Logout current device', status: 204, description: 'Immediately revokes the supplied session. Other devices stay logged in; login throttling does not block logout.' },
  { method: 'post', path: '/api/v1/auth/logout-all', summary: 'Logout all devices', status: 204, description: 'Revokes all of the authenticated account sessions, including the supplied token.' },
];

/** Publish explicit success/error schemas and parameters for every documented endpoint. */
function createPaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of operations) {
    const status = operation.status ?? 200;
    const responses: Record<string, unknown> = {
      [status]: { description: 'Success', ...(status === 204 ? {} : { content: { [operation.responseContentType ?? 'application/json']: { schema: operation.response ? ref(operation.response) : { type: 'object' } } } }) },
    };
    for (const code of operation.errors ?? [400, 401, 403, 404, 409, 429, 500]) {
      responses[code] = { description: 'Error; see error.code and error.message', content: { 'application/json': { schema: ref('Error') } } };
    }
    const parameters = [
      ...[...operation.path.matchAll(/\{(\w+)\}/g)].map(match => ({ name: match[1], in: 'path', required: true, schema: match[1] === 'notificationId' ? { type: 'integer', minimum: 1 } : { type: 'string', format: 'uuid' } })),
      ...(operation.query ?? []).map(query => ({ name: query.name, in: 'query', required: false, description: query.description, schema: query.schema })),
    ];
    paths[operation.path] ??= {};
    paths[operation.path][operation.method] = {
      summary: operation.summary, description: operation.description, responses, parameters,
      security: operation.auth === false ? [] : [{ bearerAuth: [] }],
      ...(operation.body ? { requestBody: { required: true, content: { [operation.requestContentType ?? 'application/json']: { schema: ref(operation.body), example: operation.example } } } } : {}),
    };
  }
  return paths;
}

export const openapi = {
  openapi: '3.0.3', info: { title: 'Task Management API', version: '1.0.0' }, servers: [{ url: '/' }],
  components: { schemas, securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } }, paths: createPaths(),
};
