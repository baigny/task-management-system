# Task Management System

Collaborative task management REST API built with Express, TypeScript, and PostgreSQL.

Development takes place on `feat-task-management`, branched from `main`.
See the [implementation tracker](docs/IMPLEMENTATION_TRACKER.md) for brief coverage,
remaining work, and code review decisions.

## Local setup

Requires Node.js 24+ and npm.

```sh
npm ci
cp .env.example .env
# Generate a JWT secret and paste it into .env; never commit the output.
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
npm run db:generate
npm run check
```

`DATABASE_URL`, `JWT_SECRET`, `PORT`, `CORS_ORIGIN`, and `UPLOAD_DIR` configure
the service. JWT secrets must contain at least 32 characters, and example secrets
are rejected in production. The local `.env` is ignored by Git. Never commit credentials.

`npm run check` runs type checking, linting, configuration tests, and compilation.
GitHub Actions runs the same checks for every feature branch push and pull request.
The workflow pins [checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
and [setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) to
immutable commits, uses their Node.js 24 runtime, and does not persist checkout credentials.
Dependencies and database models are introduced with the features that use them.

## HTTP API

Run `npm run dev` for development or `npm run build && npm start` for compiled code.
The API listens on `http://localhost:3000` by default. `GET /health` returns
`{ "status": "ok" }`. Swagger UI is at `/docs` and its specification is at
`/openapi.json`. Import `postman/TaskManagement.postman_collection.json` into Postman.

Errors use `{ "error": { "code": "...", "message": "..." } }`, with validation
details when applicable. JSON bodies are limited to 100 KB. Responses include an
`X-Request-Id` for correlation with structured logs; authorization and cookie headers
are redacted. Set `CORS_ORIGIN` to your frontend URL.

## PostgreSQL and Docker

Docker Desktop is required for the local database containers.

```sh
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run dev
```

`GET /ready` queries PostgreSQL and returns 503 when unavailable; `/health` stays
independent of database availability. Models and migrations arrive with each feature.
For the complete container setup, run `docker compose up --build -d --wait`. A separate
migration job finishes before the API starts, and Compose waits for the API readiness
health check. The API port follows `PORT` and binds to localhost for local development. The API runs as a nonroot user in a
runtime image without TypeScript, test tools, or the Prisma CLI. Database and upload
volumes persist across restarts. The supplied database credentials are for local use.

## Isolated integration tests

```sh
npm run db:test:up
npm run test:integration
```

`TEST_DATABASE_URL` points to `task_management_test` on port 5433; development uses
`task_management_dev` on port 5432. The test runner refuses missing URLs or database
names without the `_test` suffix before running migrations. Test PostgreSQL uses
temporary storage and never falls back to `DATABASE_URL`. CI provisions its own
PostgreSQL service and runs the same tests. `npm test` runs tests without a database.

## Maintaining API examples

Swagger and Postman share endpoint metadata in `src/openapi.ts`. When implementing
a feature, update its request/response schemas and examples in the same commit as
the routes, services, comments, tests, and README instructions. Run:

```sh
npm run docs:postman
npm run check
```

`npm run docs:check` fails when the checked-in Postman collection differs from the
API contract. Tests validate OpenAPI and the served specification. Postman includes
response status checks, and the collection's `baseUrl` is configurable.
`npm run typecheck` also checks test and tooling code. All of these checks run in CI.

## Registration and login

Register at `POST /api/v1/auth/register` with `email`, `name`, `password`, and
`confirmPassword`. Passwords must match and contain 12–128 characters; only an
Argon2id hash is stored. Duplicate emails return 409. Email addresses are normalized
to lowercase. Login accepts `email` and `password` at `POST /api/v1/auth/login`.
Both responses include a public `user`, bearer `token`, and `expiresAt` (one hour).

Tokens reference persisted database sessions. Authentication middleware validates
the token signature, issuer, audience, expiry, and active database session.
Authentication responses use `Cache-Control: no-store`; credentials never appear
in returned user profiles.

Registration/login allow 30 requests per IP per 15 minutes. Login also permits five
failed attempts per normalized email per 15 minutes, followed by a temporary cooldown.
Unknown accounts and incorrect passwords share the same error. Successful login
clears its account counter; account counters persist in PostgreSQL.
Postman automatically stores login/registration tokens.

## Profile management

Send `Authorization: Bearer <token>` to `GET /api/v1/users/me` to read your account.
`PATCH /api/v1/users/me` accepts `{ "name": "Updated name" }`. Names are trimmed
and must contain 1–100 characters. Unknown fields and changes to email, credentials,
or roles are rejected. Responses contain only `id`, `email`, `name`, and `createdAt`
and use `Cache-Control: no-store`. The account is always taken from the session.

## Logout

`POST /api/v1/auth/logout` revokes the session identified by your bearer token;
other devices remain signed in. `POST /api/v1/auth/logout-all` revokes every session
for the account, including the requesting device. Both return 204. Revoked tokens
immediately fail subsequent protected requests, even before their JWT expiry.
Login throttling does not block either logout endpoint.

## Password recovery and changes

Start the local inbox with `docker compose up -d mailpit`. Set `SMTP_HOST=localhost`
and `SMTP_PORT=1025` in `.env`, then restart the API. Open `http://localhost:8025`
to read captured emails; Mailpit never sends them externally. Docker Compose routes
the containerized API directly to Mailpit. For a real SMTP provider, configure
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`, and paired `SMTP_USER`/
`SMTP_PASSWORD` credentials. External production SMTP requires TLS or STARTTLS.

1. Call `POST /api/v1/auth/forgot-password` with `{ "email": "developer@example.com" }`.
   Known and unknown accounts receive the same 202 response. The API never returns
   the token; account lookup and SMTP delivery run after the response.
2. Copy the token from the email into Postman's `resetToken` collection variable.
   Call `POST /api/v1/auth/reset-password` with `token`, `password`, and
   `confirmPassword`. Tokens expire after 15 minutes and work once. Only token hashes
   are stored in PostgreSQL. Invalid, expired, and reused tokens share one error.
3. Log in again after a successful reset: every session and outstanding recovery token
   is revoked atomically. Concurrent attempts cannot consume the same token twice.

`POST /api/v1/auth/change-password` requires a bearer token, `currentPassword`,
`password`, and `confirmPassword`. It also revokes all sessions and recovery tokens.
New passwords follow the registration policy and must match their confirmation.
Recovery routes allow 20 requests per IP per 15 minutes. Forgot-password and
change-password each allow five attempts per account per 15 minutes.

Missing SMTP configuration returns 503 uniformly. Delivery failures are logged without
tokens or SMTP details; undelivered tokens are removed. The bounded, in-memory delivery
queue is drained during graceful shutdown. If the process is forcibly terminated before
delivery, request recovery again. No reset token is put in a URL or API response.

## Creating projects

Call `POST /api/v1/projects` with a bearer token and `{ "name": "Release" }`.
An optional `description` can contain up to 5,000 characters; names are trimmed
and must contain 1?100 characters. Unsupported fields are rejected.
The creator becomes the owner and first member atomically. A user may own multiple
projects. Postman stores the response ID as `projectId` for subsequent requests.

## Reading projects

`GET /api/v1/projects` lists only projects where you are an owner or member.
Read an individual project at `GET /api/v1/projects/{projectId}`. Nonmembers
receive 404. Lists accept `page` (default 1) and `limit` (default 20, maximum 100),
returning `{ "items": [], "total": 0, "page": 1, "limit": 20 }`.
Projects are ordered newest first with an ID tie-breaker for consistent pagination.

## Updating projects

Only the project owner can call `PATCH /api/v1/projects/{projectId}` with `name`,
`description`, or both. At least one field is required. Omitted fields retain their
values; `description: ""` explicitly clears the description. Members receive 403,
and nonmembers receive 404. Unknown fields, including `ownerId`, are rejected.

## Project deletion and activity

`DELETE /api/v1/projects/{projectId}` soft-deletes the owner's project, recording
`deletedAt` and `deletedById`. Ordinary reads and collaboration then return 404.
Memberships and project history remain intact. Owners can list their trash using
`GET /api/v1/projects?deleted=true` and restore with
`POST /api/v1/projects/{projectId}/restore`. Active projects cannot be restored again.

Permanent deletion is explicit: after soft deletion, the owner can call
`DELETE /api/v1/projects/{projectId}/permanent`. It irreversibly removes the project,
its memberships, and activity records. Active projects cannot be purged.

`GET /api/v1/projects/{projectId}/activity` returns paginated history to members;
only owners may inspect deleted projects. Creation, updates, soft deletion, and
restoration append activity in the same transaction as the change. Update history
records field names without copying description contents. History begins when this
feature is installed; existing projects do not receive fabricated past events.

## Invitations and joining projects

1. As the project owner, call `POST /api/v1/projects/{projectId}/invitations` with
   `{ "email": "teammate@example.com" }`. The response contains `invitation` and
   `token`; Postman stores `invitationToken` and `invitationId`.
2. Share the token securely. It expires after seven days and is bound to that
   normalized email. No invitation email service is required. Only its hash is stored.
3. The invitee registers or logs in with that email, then calls
   `POST /api/v1/invitations/accept` with `{ "token": "<shared token>" }` and their
   bearer token. Acceptance creates membership once, without changing ownership.
   A user can join multiple projects.

Owners can page through `GET /api/v1/projects/{projectId}/invitations` or revoke an
unused invitation with `DELETE /api/v1/projects/{projectId}/invitations/{invitationId}`.
Reissuing for the same project/email replaces the old token. Accepted invitations
cannot be revoked; membership changes are separate operations. Deleted projects
cannot issue or accept invitations. Permanent project deletion cascades invitations.

Tokens are never included in invitation lists, logs, or activity metadata. Invalid,
expired, revoked, replaced, reused, and wrong-account tokens share a 400 response.
Acceptance permits 30 attempts per IP per 15 minutes. Membership changes and activity
entries commit together under the project lock, including concurrent acceptance.

## Member roles and ownership

`GET /api/v1/projects/{projectId}/members` returns paginated public profiles with
`OWNER` or `MEMBER` roles. Roles belong to the project: someone can own one project
and be a member of another. Joining never grants ownership. Credentials and session
fields are excluded from member responses.

The owner can call `POST /api/v1/projects/{projectId}/ownership` with
`{ "newOwnerId": "<current member UUID>" }`. The nominated account must already
belong to the project; the previous owner remains a member. Owner privileges move
immediately and the activity record commits with the transfer. Concurrent transfers
are serialized so the project retains exactly one owner. Deleted projects cannot
change ownership. Set `replacementUserId` in Postman to try the example.

## Type safety and access control

Run `npm run db:generate` after schema changes to refresh Prisma model types.
Service DTOs are derived from Zod validation, public database projections use Prisma
payload types, and OpenAPI schemas/operations are checked against OpenAPI types.
Public requests have no assumed authentication context; protected controllers use a
checked accessor. Project reads use shared locks so they can proceed concurrently,
while ownership, membership, and lifecycle mutations use exclusive project locks.
Regression tests cover JWT issuer/audience/algorithm rejection and read/write locking.
