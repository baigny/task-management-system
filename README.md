# Task Management System

A backend REST API for teams to organize projects, assign tasks, and collaborate
through comment threads and protected attachments.

## Features

- Registration, login, profile updates, password recovery, and revocable sessions.
- Projects, email-bound invitations, memberships, and ownership transfer.
- Task CRUD, assignment, completion, search, filtering, sorting, and pagination.
- Multiple comment threads per task, with direct replies.
- Protected JPG, JPEG, PNG, and PDF attachments up to 10 MB.
- Soft deletion, restoration, activity history, and permanent-deletion cascades.

## Tech stack

Node.js 24+, Express 5, TypeScript, PostgreSQL 17, Prisma, Zod, Argon2id,
JWT, Multer, and Nodemailer. Tests use Vitest and Supertest; API documentation
uses OpenAPI/Swagger and Postman. Docker Compose provides local services.

## Setup

Requires Node.js 24+, npm, and Docker Desktop with Docker Compose.

```sh
git clone --branch feat-task-management https://github.com/baigny/task-management-system.git
cd task-management-system
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

In PowerShell, use `Copy-Item .env.example .env` instead of `cp`.
Paste the generated value into `JWT_SECRET` in `.env`. Keep `.env` private;
only `.env.example` belongs in Git. Preserve an existing `.env` when updating.

### Run with Docker

```sh
docker compose up --build -d --wait
```

Compose starts PostgreSQL, Mailpit, and the API, and applies migrations before
starting the API. Database and upload volumes persist across restarts.

### Run the API locally

```sh
npm ci
docker compose up -d --wait db mailpit
npm run db:generate
npm run db:migrate
npm run dev
```

For compiled code, run `npm run build` followed by `npm start`.
The API defaults to `http://localhost:3000`. Use either the Docker API or the
locally running API on this port.

## Environment variables

Copy values from [.env.example](.env.example) and adjust them for your environment.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection for the API and migrations |
| `TEST_DATABASE_URL` | Separate PostgreSQL database whose name ends in `_test` |
| `JWT_SECRET` | Random secret of at least 32 characters; replace the placeholder |
| `PORT` | API port; default `3000` |
| `CORS_ORIGIN` | Allowed client origin; default `http://localhost:5173` |
| `UPLOAD_DIR` | Private attachment directory; default `uploads` |
| `NODE_ENV` | `development`, `test`, or `production` |
| `SMTP_HOST`, `SMTP_PORT` | Password-recovery mail server; local Mailpit uses `localhost:1025` |
| `SMTP_SECURE` | `true` for implicit TLS; default `false` |
| `SMTP_USER`, `SMTP_PASSWORD` | Optional SMTP credentials; configure both together |
| `SMTP_FROM` | Sender email address |

Compose sets the API's database and SMTP hosts to their container service names.
Keep `UPLOAD_DIR=uploads` with the supplied Compose upload-volume mount.
For a production SMTP provider, configure TLS or STARTTLS. The supplied database
credentials are for local development.

## API documentation

All application routes use `/api/v1`.

- [Swagger UI](http://localhost:3000/docs): endpoint schemas, examples, permissions, and errors.
- [OpenAPI JSON](http://localhost:3000/openapi.json): machine-readable specification.
- [Postman collection](postman/TaskManagement.postman_collection.json): import and set `baseUrl`.
- `GET /health`: process health. `GET /ready`: database readiness; returns 503 during an outage.

Postman captures tokens and resource IDs from successful creation responses.
Use the API documentation for complete request/response details.

### Authentication and basic usage

Register with matching passwords of 12 to 128 characters. Registration and login
return `user`, `token`, and `expiresAt`. Send the token on protected requests:

```sh
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"developer@example.com","name":"Developer","password":"strong-password-123","confirmPassword":"strong-password-123"}'

curl http://localhost:3000/api/v1/users/me \
  -H 'Authorization: Bearer <token>'

curl -X POST http://localhost:3000/api/v1/projects \
  -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' \
  -d '{"name":"Release","description":"Coordinate the release"}'

curl 'http://localhost:3000/api/v1/tasks?assigneeId=me&status=OPEN&page=1&limit=20' \
  -H 'Authorization: Bearer <token>'
```

These curl examples use Bash syntax; Windows users can use Postman or Swagger.
Passwords are hashed with Argon2id. JWTs expire after one hour and reference database
sessions. `/auth/logout` revokes the current session; `/auth/logout-all` revokes all
sessions immediately. Authentication and recovery endpoints are rate-limited.

For password recovery, call `POST /api/v1/auth/forgot-password` with an email.
Read the local recovery email at [Mailpit](http://localhost:8025), then send its token
and matching new passwords to `/api/v1/auth/reset-password`. Tokens expire after
15 minutes and work once. Resetting or changing a password revokes all sessions.
Mailpit captures local mail without sending it externally.

### Project collaboration

1. Create a project; its creator becomes the owner.
2. As owner, `POST /projects/{projectId}/invitations` with the invitee's email.
3. Share the returned token securely. It expires after seven days and is single-use.
4. The invitee logs in with that email and calls `POST /invitations/accept` with
   `{ "token": "<invitation-token>" }`. Both paths use the `/api/v1` prefix.

Users can belong to multiple projects. Owners manage project details, invitations,
membership, and ownership. Members can create and update project tasks and assign
current members. Removing a member supports manual reassignment or automatic
assignment to the least-loaded remaining members, with the owner as fallback.
Owners must transfer ownership before leaving.

Task statuses are `OPEN`, `IN_PROGRESS`, and `COMPLETED`. Lists support search,
status/project/assignee filters, and allowlisted sorting. Pagination returns
`items`, `total`, `page`, and `limit`; default limit is 20 and maximum is 100.

To start a task thread, post `{ "body": "Please review this" }` to
`/projects/{projectId}/tasks/{taskId}/comments`. Add `parentId` to reply to a thread
root on that task. Authors or owners can remove comment text while preserving replies.

Upload one multipart `file` to `/projects/{projectId}/tasks/{taskId}/attachments`.
Only `.jpg`, `.jpeg`, `.png`, and `.pdf` are accepted, with matching media types and
signatures, up to 10 MB (10,485,760 bytes). Downloads require current membership;
uploaders or owners can remove files. See Swagger/Postman for the download route.

Members may soft-delete tasks; only owners restore or permanently purge them.
Project deletion is owner-only. Soft-deleting a project hides its children;
restoration preserves each task's own trash state. Permanent deletion requires
prior soft deletion and cascades child records. Physical file deletion uses a
durable retry queue. Removed members lose access to subsequent requests.

### Errors

Errors use `{ "error": { "code": "...", "message": "..." } }`; validation errors
may include `details`. Common statuses are 400 (validation), 401 (authentication),
403 (permission), 404 (missing/inaccessible resource), 409 (conflict), 413 (size),
415 (file type), and 429 (rate limit). Requests include `X-Request-Id` for log correlation.

## Tests and development commands

```sh
npm run check
npm run db:test:up
npm run test:integration
```

`check` runs type checking, linting, Swagger/Postman consistency checks, unit/contract
tests, and build. Integration tests apply migrations to the isolated test database
on port 5433; development PostgreSQL uses port 5432. The runner rejects database names
without `_test` and never falls back to the development connection. GitHub Actions
runs checks and integration tests against PostgreSQL for branch pushes and PRs.

| Command | Purpose |
| --- | --- |
| `npm test` | Unit and API contract tests without a database server |
| `npm run db:generate` | Regenerate Prisma client/types after schema changes |
| `npm run db:dev -- --name <name>` | Create and apply a development migration |
| `npm run db:migrate` | Apply committed migrations |
| `npm run docs:postman` | Regenerate Postman from `src/openapi.ts` |
| `npm run docs:check` | Check Postman matches the API contract |

Update implementation, function comments, tests, Swagger, Postman, and relevant
README guidance together when adding a feature.

## Project structure

```text
src/
  auth/          Authentication, sessions, profile, recovery, and cleanup
  projects/      Project CRUD and lifecycle
  invitations/   Invitation issuance and acceptance
  members/       Membership, ownership, and reassignment
  tasks/         Task CRUD, discovery, assignment, and lifecycle
  comments/      Threads and replies
  attachments/   Uploads, downloads, private storage, and cleanup
  app.ts         Express middleware and route registration
  access.ts      Shared project authorization and transactions
  openapi.ts     API schemas and endpoint metadata
prisma/          Database schema and versioned migrations
postman/         Generated API collection
tests/           Unit, contract, and PostgreSQL integration tests
scripts/         Documentation and test tooling
```

## Current limitations

The application is API-only and uses one API instance for local-file storage and
cleanup. Invitation tokens are shared manually; invitation email delivery is not
included. Notifications, SSE, and Gemini assistance are not implemented yet.
