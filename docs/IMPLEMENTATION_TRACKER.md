# Implementation tracker

Reviewed against the project brief and accepted plan on 20 November 2026.
This is a backend-only submission. Completion means implementation, relevant tests,
function documentation, Swagger, Postman, and README are included together.

## Delivery status

| Requirement | Status | Evidence or remaining work |
| --- | --- | --- |
| Express, TypeScript, npm, PostgreSQL, Prisma | Pushed | Strict compilation, schema, versioned migrations, generated client |
| Foundation and secure configuration | Pushed | Validation, logging/redaction, request limits, CORS, consistent errors, health/readiness |
| Registration and login | Pushed | Argon2id, confirmation, JWT issuer/audience/algorithm checks, IP/account throttling |
| Profile management | Pushed | Public profile read and allowlisted name update |
| Secure logout | Pushed | Database sessions; current-device and all-device revocation |
| Password recovery/change | Pushed | SMTP delivery, hashed expiring single-use tokens, session revocation; local Mailpit smoke test |
| Project Create / Read / Update / Delete | Pushed separately | Ownership, membership-scoped reads, pagination, owner-only mutation, trash, restore, purge |
| Project activity | Pushed | Creation/update/deletion/restore records are transactional; permanent purge removes project history |
| Invitations and joining | Pushed | Owner issue/list/revoke; email-bound, expiring, single-use, hashed tokens; no outbound invitation email |
| Member profiles and ownership transfer | Pushed | Public profile pages, per-project roles, existing-member transfer, concurrent transfer tests |
| Current-stage code review fixes | Verified in this review | Optional checked auth context, schema-derived DTOs, compiler-checked OpenAPI types, shared read locks, unknown error narrowing, typed activity actions, dead-code removal, Docker readiness |
| Member removal / leaving | Verified in this batch | Owner protection, manual/automatic reassignment, preview, transactional membership change |
| Automatic workload balancing | Verified in this batch | Count unfinished, non-deleted tasks in the current project; zero-work members first; stable ties; update counts after every assignment; owner fallback |
| Task Create / Read / Update / Delete | Create pushed; Read/discovery verified in this batch; Update/lifecycle pending | Title/description/due date/status/assignment; project membership checks; members soft-delete; owners restore/purge |
| Task discovery | Verified in this batch | Assigned-to-me across accessible projects, status/project/assignee filters, title-description search, allowlisted sorting, pagination |
| Parent-child deletion | Partly complete | Projects now cascade memberships, invitations, activity, and tasks on purge. Add comments/attachments/notifications FKs and stored-file cleanup with those features. Soft project deletion hides children without overwriting their own deletion state |
| Comments | Pending | Membership checks, author/owner deletion permissions |
| Attachments | Pending | Protected upload/download, generated storage names, content validation, 10 MB limit, file allowlist, durable cleanup |
| Notifications | Pending | Persist assignment/task-update records atomically; exclude self-notifications; list/read APIs |
| Real-time updates | Pending extension, accepted scope | Authenticated SSE, heartbeat, replay, session-expiry/revocation disconnect |
| Gemini assistance | Pending extension, accepted scope | SDK, authenticated/rate-limited description and summary suggestions, configuration/timeouts/provider failure tests |
| Local AI secret | Prepared | Gitignored local `.env` has a blank key. No live provider test until a key is supplied |
| Swagger / Postman / README | Pushed per implemented batch | Contracts cover implemented routes only. Each remaining feature must update all three with its implementation |
| Docker and CI | Established | Current API rebuilt and collaboration smoke passed (invite, transfer, permissions, delete/restore/purge). Repeat full flow after remaining features |
| Public GitHub repository | Created | https://github.com/baigny/task-management-system |
| Open PR targeting main | Pending | Create after final feature checks; verify visibility, branch ancestry, commit identities, and PR base |

## Code review decisions

| Principle | Necessary application | Avoid for now |
| --- | --- | --- |
| Single responsibility | Routes wire middleware; controllers validate/translate HTTP; services own transactions and authorization; Prisma owns persistence | Splitting every small function into its own class/file |
| Open/closed and interface segregation | Extend feature modules and typed contracts as real requirements arrive | Generic CRUD frameworks and broad service interfaces |
| Liskov substitution | Preserve typed contracts; no custom inheritance hierarchy is currently needed | Base service classes introduced solely to claim SOLID compliance |
| Dependency inversion | Inject readiness probes where outage tests need a seam; use real isolated PostgreSQL for transactional behavior | A repository interface that only copies Prisma methods |
| DRY | Infer inputs from Zod; share auth/project access, pagination, public-profile selection, and Swagger/Postman metadata | Combining unrelated business rules just because their syntax looks similar |
| KISS | One API instance, relational transactions, generated Prisma types, explicit owner/member rules | Microservices, distributed locks, queues, or a DI container for this scope |
| YAGNI | Add task/file/notification models with the functional feature using them | Frontend behavior, deployment, outbound invitation email, speculative abstractions |
| Efficiency | Bound lists and payloads, index access paths, select public fields, allow shared project reads, lock mutations consistently | Claims of scalability without workload measurements |

## Necessary remaining quality checks

- Keep subsequent implementation, tests, comments, Swagger, Postman, and README in the same functional batch.
- Cover removal/assignment races, restoration of tasks with departed assignees, deletion cascades, protected files, SSE reconnect/revocation, and AI failures with the features.
- Add bounded cleanup for expired sessions, recovery tokens, and stale throttle records before final delivery.
- Keep activity for membership, ownership, assignment, deletion, and restoration changes in the same transaction as each change.
- Keep single-instance storage/SSE limits explicit. Add Redis/object storage only if deployment requirements change.
- Run final type/lint/contract/build/PostgreSQL checks, dependency audit, clean Docker migration/startup, and the documented collaboration flow.
- Verify generated Prisma types after schema changes with `npm run db:generate`; never maintain handwritten copies of database models.

## Current review validation

- Prisma client regenerated; no missing model or DTO type errors remain in compilation.
- Type checking, linting, OpenAPI validation/Postman consistency, and build passed.
- 20 unit/contract tests and 75 isolated PostgreSQL integration tests passed.
- Member-removal tests cover automatic/manual allocation, zero-workload priority, stable ties, owner fallback, completed/deleted history, invitation revocation, stale previews, concurrent removal, rollback, and a 1,100-task batch.
- Regression coverage includes absent auth context, JWT issuer/audience/algorithm/claims,
  concurrent shared reads, and an actual PostgreSQL lock timeout for conflicting writes.
- Dependency audit reported zero vulnerabilities at review time.
- CI actions were updated from deprecated Node.js 20 releases to official Node.js 24 releases, pinned by immutable commit; checkout credentials are not persisted.
- Docker images rebuilt; migrations completed; Compose waited for API readiness.
- Live Docker collaboration smoke passed invitations, ownership transfer, permission
  checks, soft deletion, restoration, and permanent purge. Only its randomly generated
  fixture accounts/project were cleaned up.

## Next functional batches

1. Implement task APIs in functional batches: Create, Read/discovery, Update/assignment, and deletion/restoration lifecycle.
2. Add comments and protected attachments.
3. Add persisted notifications/SSE and Gemini suggestions.
4. Complete bounded housekeeping, end-to-end validation, and the open PR to `main`.
