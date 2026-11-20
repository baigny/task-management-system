export type Schema = Record<string, unknown>;
export type Operation = {
  method: 'get' | 'post' | 'patch' | 'delete'; path: string; summary: string;
  description?: string; auth?: boolean; status?: number; errors?: number[];
  body?: string; example?: Record<string, unknown>; response?: string;
  requestContentType?: string; responseContentType?: string;
  query?: { name: string; schema: Schema; example?: string; description?: string }[];
  save?: { variable: string; path: string }[];
};
/** Reference a reusable request or response schema. */
export const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
/** Describe closed objects, omitting the OpenAPI required list for entirely optional fields. */
export const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
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
  ForgotPassword: object({ email: { type: 'string', format: 'email', maxLength: 254 } }),
  RecoveryAccepted: object({ message: { type: 'string' } }),
  ResetPassword: object({ token: { type: 'string', pattern: '^[a-f0-9]{64}$', writeOnly: true }, password: ref('Password'), confirmPassword: { allOf: [ref('Password')], description: 'Must match password.' } }),
  ChangePassword: object({ currentPassword: { type: 'string', minLength: 1, maxLength: 128, writeOnly: true }, password: ref('Password'), confirmPassword: { allOf: [ref('Password')], description: 'Must match password.' } }),
  Project: object({ id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, description: { type: 'string' }, ownerId: { type: 'string', format: 'uuid' }, createdAt: { type: 'string', format: 'date-time' }, deletedAt: { type: 'string', format: 'date-time', nullable: true }, deletedById: { type: 'string', format: 'uuid', nullable: true } }),
  ProjectList: object({ items: { type: 'array', items: ref('Project') }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } }),
  ProjectUpdate: { ...object({ name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 5000 } }, []), minProperties: 1 },
  ActivityList: object({ items: { type: 'array', items: object({ id: { type: 'string', format: 'uuid' }, projectId: { type: 'string', format: 'uuid' }, actorId: { type: 'string', format: 'uuid', nullable: true }, action: { type: 'string' }, entityId: { type: 'string', nullable: true }, metadata: { type: 'object', additionalProperties: true }, createdAt: { type: 'string', format: 'date-time' } }) }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } }),
  Invitation: object({ id: { type: 'string', format: 'uuid' }, projectId: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' }, invitedById: { type: 'string', format: 'uuid' }, expiresAt: { type: 'string', format: 'date-time' }, createdAt: { type: 'string', format: 'date-time' }, acceptedAt: { type: 'string', format: 'date-time', nullable: true }, revokedAt: { type: 'string', format: 'date-time', nullable: true } }),
  InvitationInput: object({ email: { type: 'string', format: 'email', maxLength: 254 } }),
  InvitationResult: object({ invitation: ref('Invitation'), token: { type: 'string', writeOnly: false, description: 'Returned only at issuance; share securely with the invited account.' } }),
  InvitationAcceptance: object({ token: { type: 'string', pattern: '^[a-f0-9]{64}$', writeOnly: true } }),
  InvitationList: object({ items: { type: 'array', items: ref('Invitation') }, total: { type: 'integer' }, page: { type: 'integer' }, limit: { type: 'integer' } }),
  ProjectInput: object({ name: { type: 'string', minLength: 1, maxLength: 100 }, description: { type: 'string', maxLength: 5000, default: '' } }, ['name']),
};

export const pageParameters = [
  { name: 'page', schema: { type: 'integer', minimum: 1, maximum: 100000, default: 1 } },
  { name: 'limit', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
];

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
  { method: 'post', path: '/api/v1/auth/forgot-password', summary: 'Request password reset', auth: false, status: 202, body: 'ForgotPassword', response: 'RecoveryAccepted', errors: [400, 429, 500, 503], example: { email: 'developer@example.com' }, description: 'Known and unknown emails receive the same message; the token is delivered only by SMTP. Five requests per email per 15 minutes. Delivery is deferred until after the response. Missing SMTP configuration returns 503 uniformly.' },
  { method: 'post', path: '/api/v1/auth/reset-password', summary: 'Reset password', auth: false, status: 204, body: 'ResetPassword', errors: [400, 429, 500], example: { token: '{{resetToken}}', password: 'replacement-password-123', confirmPassword: 'replacement-password-123' }, description: 'Consumes a single-use token within 15 minutes, revokes all sessions and outstanding reset tokens, and requires a fresh login. Passwords must match. Expired, invalid, or reused tokens return the same 400 error.' },
  { method: 'post', path: '/api/v1/auth/change-password', summary: 'Change password', status: 204, body: 'ChangePassword', example: { currentPassword: 'strong-password-123', password: 'replacement-password-123', confirmPassword: 'replacement-password-123' }, description: 'Requires a valid session, current password, and matching new passwords. Revokes every session and reset token. Five attempts per account per 15 minutes. All password-recovery routes share a separate 20-request IP limit per 15 minutes.' },
  { method: 'post', path: '/api/v1/projects', summary: 'Create project', status: 201, body: 'ProjectInput', response: 'Project', example: { name: 'Release', description: 'Coordinate the release' }, save: [{ variable: 'projectId', path: 'id' }], description: 'Creates the project and its owner membership atomically.' },
  { method: 'get', path: '/api/v1/projects', summary: 'List projects', response: 'ProjectList', query: [...pageParameters, { name: 'deleted', schema: { type: 'string', enum: ['true', 'false'], default: 'false' } }], description: 'Lists active projects the caller belongs to, newest first with an ID tie-breaker. deleted=true lists only the caller-owned deleted projects.' },
  { method: 'get', path: '/api/v1/projects/{projectId}', summary: 'View project', response: 'Project', description: 'Members only. Nonmembers receive 404.' },
  { method: 'patch', path: '/api/v1/projects/{projectId}', summary: 'Update project', body: 'ProjectUpdate', response: 'Project', example: { name: 'Updated release' }, description: 'Owner only. Requires at least one supported field. Omitted fields remain unchanged; ownership changes are rejected.' },
  { method: 'delete', path: '/api/v1/projects/{projectId}', summary: 'Soft-delete project', status: 204, description: 'Owner only. Keeps memberships and history; deleted projects are hidden from ordinary reads and collaboration.' },
  { method: 'post', path: '/api/v1/projects/{projectId}/restore', summary: 'Restore project', response: 'Project', description: 'Owner only. Restores a deleted project and preserves memberships. Already active projects return 409.' },
  { method: 'delete', path: '/api/v1/projects/{projectId}/permanent', summary: 'Permanently delete project', status: 204, description: 'Owner only. Requires prior soft deletion. Irreversibly removes the project, memberships, and project activity.' },
  { method: 'get', path: '/api/v1/projects/{projectId}/activity', summary: 'List project activity', response: 'ActivityList', query: pageParameters, description: 'Members can inspect active project history. Only the owner can inspect a deleted project. Changes and history entries are atomic; update records contain changed field names rather than field contents.' },
  { method: 'post', path: '/api/v1/projects/{projectId}/invitations', summary: 'Invite project member', status: 201, body: 'InvitationInput', response: 'InvitationResult', example: { email: 'teammate@example.com' }, save: [{ variable: 'invitationToken', path: 'token' }, { variable: 'invitationId', path: 'invitation.id' }], description: 'Owner only. Returns a seven-day single-use token bound to the normalized email. Reissuing replaces earlier tokens for this project/email. Existing members return 409. No outbound email is sent.' },
  { method: 'get', path: '/api/v1/projects/{projectId}/invitations', summary: 'List project invitations', response: 'InvitationList', query: pageParameters, description: 'Owner only. Lists invitation state without secrets or token hashes.' },
  { method: 'delete', path: '/api/v1/projects/{projectId}/invitations/{invitationId}', summary: 'Revoke invitation', status: 204, description: 'Owner only. Revokes an unused invitation. Repeated revocation is harmless; accepted invitations return 409.' },
  { method: 'post', path: '/api/v1/invitations/accept', summary: 'Accept project invitation', body: 'InvitationAcceptance', response: 'Project', example: { token: '{{invitationToken}}' }, description: 'Authenticate as the invited email account. Invalid, expired, revoked, replaced, reused, and wrong-account tokens return the same 400. Joining a deleted project is forbidden. Creates membership and activity atomically. Limited to 30 attempts per IP per 15 minutes.' },
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
