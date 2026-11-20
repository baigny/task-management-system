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
