# Task 7 Report: Usuários e auditoria

## Status: DONE_WITH_CONCERNS

## What I implemented

- **Audit helper** (`src/audit/audit.ts`): `audit(db, entry)` inserts an `audit_log` row with a UUIDv7 id, optional `userId/targetType/targetId/ip`, serialized `dataJson`, and `createdAt`. The `AuditEntry` type matches the interface in the brief.
- **User routes** (`src/api/routes/users.ts`):
  - `GET /api/users` (admin): lists users through `toPublic`, which strips `passwordHash` and `updatedAt`.
  - `POST /api/users` (admin): validates username/password/role, normalizes the username to lowercase, rejects duplicates with 409, hashes with `hashPassword`, and only the root may create admins (403 otherwise). Writes `user.create` to the audit log.
  - `PATCH /api/users/:id` (admin): rejects unknown users (404), makes the root immutable (403), lets only the root manage admins (403), protects the last active non-root admin (409), revokes sessions when a user is disabled, and writes `user.update` to the audit log.
  - `POST /api/users/:id/reset-password` (admin): rejects unknown users (404), only the root resets the root password or another admin's password (403), hashes and stores the new password, revokes the target's sessions, and writes `user.reset_password`.
- **Route registration** (`src/api/app.ts`): `registerUserRoutes(app, deps)` added after the auth routes.
- **Tests** (`tests/integration/users.test.ts`): the five integration tests from the brief (create/list/change role, non-root admin cannot create admins, last active admin protection, root immutability, viewer denied listing).

## What I tested and results

- Focused RED then GREEN: `corepack yarn test tests/integration/users.test.ts` — 5/5 passed after implementation.
- `corepack yarn typecheck` — exit 0.
- `corepack yarn lint` — exit 0.
- `corepack yarn test` — **10 files, 38 tests passed** (33 pre-existing + 5 new).
- Note: the globally installed `yarn` is 1.22.22 while the project pins `yarn@4.5.1`; I used `corepack yarn` to run the pinned version, consistent with the previous task reports. No pnpm used.

## TDD evidence

### RED

Command:

```
corepack yarn test tests/integration/users.test.ts
```

Result:

```
❯ tests/integration/users.test.ts (5 tests | 5 failed)
  × usuários > cria, lista e altera papel
    → expected 404 to be 201 // Object.is equality
  × usuários > impede root de criar admin sem ser root
    → Cannot read properties of undefined (reading 'value')
  × usuários > protege o último administrador ativo
    → Cannot read properties of undefined (reading 'id')
  × usuários > não altera o root
    → Cannot read properties of undefined (reading 'find')
  × usuários > viewer não acessa a lista
    → Cannot read properties of undefined (reading 'value')

Test Files 1 failed (1)
Tests 5 failed (5)
```

Expected failure: the user routes were not registered yet, so `POST/GET /api/users` returned 404 and the remaining assertions failed on the missing response body. The failures were missing functionality, not typos.

### GREEN

Focused:

```
corepack yarn test tests/integration/users.test.ts
✓ tests/integration/users.test.ts (5 tests)
Test Files 1 passed (1)
Tests 5 passed (5)
```

Checkpoint:

```
corepack yarn typecheck   → exit 0
corepack yarn lint        → exit 0
corepack yarn test        → Test Files 10 passed (10), Tests 38 passed (38)
```

## Files changed

Created:

- `src/audit/audit.ts`
- `src/api/routes/users.ts`
- `tests/integration/users.test.ts`

Modified:

- `src/api/app.ts` (import and register `registerUserRoutes`)

## Self-review findings

1. **Brief bug fixed (compile):** the supplied `users.ts` used `and` and `ne` in `countActiveAdmins` without importing them. Imported `and, eq, ne` from `drizzle-orm`.
2. **Brief bug fixed (lint):** the supplied `users.ts` imported `FastifyRequest` without using it. Removed the unused import.
3. **Last-admin rule made reachable:** with the brief's literal count (all active admins including root), the root is itself always an active admin and is immutable, so `countActiveAdmins(...) === 0` can never be true and the brief's own `protege o último administrador ativo` test would receive 200 instead of 409. I changed the helper to `countActiveNonRootAdmins` (adds `eq(users.isRoot, false)`) so the supplied 409 expectation holds and the invariant is at least one active non-root admin. This is the one intentional semantic deviation from the brief's code.
4. **Secrets not leaked:** all responses use `toPublic`; `passwordHash` and `updatedAt` are never returned. The list is admin-only.
5. **Role rules verified:** non-root admins cannot create admins, patch admins, or reset admin passwords; root can manage admins; root cannot be patched; viewers are rejected by `requireRole`.
6. **Session hygiene:** disabling a user and resetting a password both call `revokeUserSessions`; role changes do not revoke sessions (role is re-read from the DB on every request via `resolveSession`).
7. **Audit coverage:** create, update, and reset-password each write actor id, action, target type/id, optional data, and IP. The inserts are exercised by the passing tests.
8. No comments added; strict TS and ESM conventions preserved. No git repository used or initialized.

## Concerns

1. **Last-admin semantics need product confirmation:** the implementation protects the last active *non-root* admin, matching the supplied test. If the intended rule is that root counts as an active admin, the supplied test is inconsistent (the rule becomes unreachable) and both the count and the test should be revised.
2. **Audit rows are not directly asserted:** the route tests exercise the audit inserts (a failure would surface as 500), but no test inspects `action`, `dataJson`, or `ip` values.
3. **No audit listing endpoint:** the spec lists `GET /api/audit` for admins; it was not part of this task's files and is not implemented here.
4. **Audit insert is outside a transaction:** if the audit insert fails after a user insert/update, the user change is persisted but the request returns 500 without an audit row. Wrapping mutation + audit in one transaction would close this gap.
5. **Duplicate-user race:** the existence check happens before `hashPassword`; two concurrent requests for the same username could both pass the check and the unique index would turn the second into a 500 instead of 409. Low likelihood in a single-node SQLite deployment.
6. **No dedicated rate limit on user routes:** only the login/setup limits exist; the authenticated API limit (120/min per session) from the spec is not wired in this task.
