# Task Management System

Collaborative task management REST API built with Express, TypeScript, and PostgreSQL.

Development takes place on `feat-task-management`, branched from `main`.

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
For the complete container setup, run `docker compose up --build -d`. A separate
migration job finishes before the API starts. The API runs as a nonroot user in a
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
