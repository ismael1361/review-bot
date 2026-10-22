# Task 5 Report: Setup do root com token de setup

## Status

DONE_WITH_CONCERNS

## What I implemented

- `src/api/errors.ts`: `AppError` (message, `code`, `statusCode`) and `errorBody(code, message, details?)`.
- `src/auth/setup.ts`:
  - `isSetupComplete(db)` reads the `setup_complete` setting.
  - `ensureSetupToken(db, logger, envToken?)` is idempotent: skips when setup is complete or when a token hash already exists and no env token was supplied; otherwise stores the SHA-256 hash of the env token (or a generated 32-byte base64url token) and logs the plaintext token once via `logger.warn`.
  - `completeSetup(db, { token, username, password })` rejects completed setup with `409 setup_already_complete`, rejects a missing/mismatched token with `401 invalid_setup_token` (constant-time compare), hashes the password with Argon2id, then in one SQLite transaction inserts the root user (`role: admin`, `isRoot: true`, lowercased username), upserts `setup_complete = true`, and deletes `setup_token_hash`.
- `src/api/routes/setup.ts`: `GET /api/setup/status` returns `{ needsSetup }`; `POST /api/setup` validates the body with Zod (`token` non-empty, username 3-64 chars `[a-zA-Z0-9._-]`, password 12-200), calls `completeSetup`, logs the created userId, and returns `201 { userId }`. The route carries the rate-limit route config from the brief.
- `src/api/app.ts`: `AppDeps = { db, config, logger, encryptionKey }`; `buildApp(deps)` builds Fastify with the injected logger and `trustProxy`, installs the error handler (`AppError` -> its status/body, `ZodError` -> `400 validation_error` with issues, otherwise logs and returns `500 internal_error`), and registers health and setup routes.
- `tests/helpers/app.ts`: `createTestDeps()` builds an in-memory migrated DB, test config, pino logger and encryption key; `createTestApp()` seeds the fixed test setup token and returns `{ app, deps }`.
- `tests/integration/setup.test.ts`: coverage for status, invalid token (401), successful root creation/closure (201, status false, second attempt 409), and minimum password (400).
- `tests/integration/health.test.ts`: updated to build the app through `createTestApp()`.

Per the task context, `buildApp` and `createTestApp` remain synchronous; the async version is reserved for Task 6.

## What I tested and results

Tooling note: after a clean checkout, the global `yarn` is 1.22.22 and Corepack is not enabled, so `yarn test` refuses to run. I invoked the project's Yarn 4.5.1 through `corepack yarn ...` (equivalent to the requested `yarn ...`; no pnpm used).

| Command | Result |
|---|---|
| `corepack yarn test` (baseline before changes) | 6 files, 15 tests passed |
| `corepack yarn test tests/integration/setup.test.ts tests/integration/health.test.ts` (RED) | 2 suites failed: `Cannot find module '../../src/auth/setup'` |
| `corepack yarn test tests/integration/setup.test.ts tests/integration/health.test.ts` (GREEN) | 2 files, 5 tests passed |
| `corepack yarn typecheck` | Passed, no output |
| `corepack yarn lint` | Passed, no output |
| `corepack yarn test` | 7 files, 19 tests passed |

Extra manual verification (one-off `tsx -e`, no file left behind): after `completeSetup` with username `ROOT`, the DB contained exactly one user `{ username: 'root', role: 'admin', isRoot: true, disabled: false }`, `verifyPassword` confirmed the Argon2 hash, `app_settings` contained only `setup_complete`, `setup_token_hash` was gone, and `isSetupComplete` returned true.

## TDD evidence

### RED

Command:

```
corepack yarn test tests/integration/setup.test.ts tests/integration/health.test.ts
```

Output (excerpt):

```
Failed Suites 2

FAIL tests/integration/health.test.ts [ tests/integration/health.test.ts ]
FAIL tests/integration/setup.test.ts [ tests/integration/setup.test.ts ]
Error: Cannot find module '../../src/auth/setup' imported from 'D:/projetos/review-bot/tests/helpers/app.ts'

 Test Files  2 failed (2)
      Tests  no tests
Caused by: Error: Failed to load url ../../src/auth/setup ... Does the file exist?
```

Why expected: the tests were written first, before any Task 5 production module existed. `tests/helpers/app.ts` imports `ensureSetupToken` from `src/auth/setup.ts`, which did not exist yet, so both suites failed to load. This is the expected RED for the missing setup feature; it is not a typo or environment failure. No production code had been written at that point.

### GREEN

Command:

```
corepack yarn test tests/integration/setup.test.ts tests/integration/health.test.ts
```

Output (summary):

```
✓ tests/integration/health.test.ts (1 test)
✓ tests/integration/setup.test.ts (4 tests)

 Test Files  2 passed (2)
      Tests  5 passed (5)
```

Full suite afterwards:

```
 Test Files  7 passed (7)
      Tests  19 passed (19)
```

## Files changed

Created:

- `src/api/errors.ts`
- `src/auth/setup.ts`
- `src/api/routes/setup.ts`
- `tests/helpers/app.ts`
- `tests/integration/setup.test.ts`

Modified:

- `src/api/app.ts`
- `tests/integration/health.test.ts`

No other tracked files were touched. No git repository exists; nothing was initialized or committed.

## Self-review findings

- Brief inconsistency: the "Interfaces" section announces `createTestApp(): Promise<{ app, db, deps }>`, while Step 5 specifies the synchronous `{ app, deps }` helper. The task context explicitly says Task 6 will make `buildApp` async and update the helper and to implement this task's version now. Implemented the Step 5 version; tests use it successfully.
- One necessary deviation in `src/api/app.ts` for strict typecheck: Fastify 5.12.7 infers the instance's logger generic from `loggerInstance`, so a pino `Logger` produced an instance incompatible with route helpers typed as the default `FastifyInstance` (`FastifyBaseLogger`). Fixed by widening only at construction: `const logger: FastifyBaseLogger = deps.logger;`. Runtime is unchanged, `AppDeps.logger` remains a pino `Logger`, and `deps.logger` is still used for the error log. No casts and no `any`.
- Verified the implementation matches the brief's code and error contracts (`setup_already_complete` 409, `invalid_setup_token` 401, `validation_error` 400, `internal_error` 500).
- Verified the username is lowercased, the password is stored only as an Argon2 hash, `isRoot`/`role` are correct, the setup token hash is deleted, and setup is idempotently rejected afterwards.
- Confirmed no comments were added, ESM imports are used, and strict TypeScript settings are satisfied.
- Confirmed existing unit tests (config, crypto, logger, password, db) still pass.

## Concerns

1. The `rateLimit` route config on `POST /api/setup` is inert because `@fastify/rate-limit` is not registered in `buildApp`. That registration was not part of this task or its brief; it needs to be wired in a later task (probably alongside the remaining plugins), otherwise the 5-requests/minute limit does not actually apply.
2. Setup has a check-then-act race: two concurrent `POST /api/setup` requests can both pass `isSetupComplete` while `hashPassword` awaits, then each opens its own transaction. With different usernames both roots could be created. SQLite serializes the writes but does not prevent this logical double-setup. The brief's code was implemented as specified; a later hardening pass could re-check inside the transaction or add a single-root constraint.
3. `ensureSetupToken` intentionally logs the plaintext one-time token via `logger.warn` (required so the operator can complete setup). It therefore appears in production logs, and in test output. Log retention/access should treat it as a secret.
4. Tests use the real pino logger at `info` level, so the suite prints request logs and the setup-token warning. All assertions pass; output is noisy by design of the brief's helper, not an error.

## Report file

`D:\projetos\review-bot\.superpowers\sdd\2026-10-22-review-bot-1-fundacao\task-5-report.md`

---

# Fix Report (post-review)

## Changes

- `src/auth/setup.ts` (`completeSetup`): after `await hashPassword`, the transaction now re-reads `setup_complete` and `setup_token_hash` through `tx` before any insert. It throws `409 setup_already_complete` if the completion row exists and `401 invalid_setup_token` if the token row is missing or does not constant-time match. The synchronous better-sqlite3 transaction serializes the second request, so only one root can be created. The existing pre-checks remain as the fast path.
- `src/auth/setup.ts` (`ensureSetupToken`): if an env token is supplied and `existingHash === hashToken(envToken)`, it returns before generating/storing/logging. The one-time token warning is no longer emitted on every boot for an unchanged env token.
- `tests/integration/setup.test.ts`:
  - Success test now destructures `{ app, deps }`, asserts `created.json().userId` is truthy, asserts the persisted user is `{ username: 'root', role: 'admin', isRoot: true }`, and asserts the `setup_token_hash` row was deleted (via `drizzle-orm` `eq` and `appSettings`, `users`).
  - Added `rejeita setup concorrente`, firing two `POST /api/setup` requests concurrently (usernames `root` and `root2`) and asserting sorted statuses `[201, 409]`.

No production changes outside `src/auth/setup.ts`; no test changes outside `tests/integration/setup.test.ts`.

## TDD evidence

### RED

Command:

```
corepack yarn test tests/integration/setup.test.ts
```

Output (excerpt):

```
✓ setup > indica que o setup é necessário
✓ setup > rejeita token inválido
✓ setup > cria o root e encerra o setup
× setup > rejeita setup concorrente
  → expected [ 201, 201 ] to deeply equal [ 201, 409 ]
✓ setup > valida senha mínima

 Test Files  1 failed (1)
      Tests  1 failed | 4 passed (5)
```

Why expected: both concurrent requests passed the pre-transaction `isSetupComplete`/token checks while `hashPassword` awaited, and the old transaction had no invariant re-check, so both inserted users (`root` and `root2`) and both returned 201. This is exactly the reported check-then-act race.

### GREEN

Command:

```
corepack yarn test tests/integration/setup.test.ts
```

Output (summary):

```
✓ tests/integration/setup.test.ts (5 tests)
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

The concurrent run produced one 201 and one 409, and the strengthened success test confirmed the persisted root and token deletion.

### Full verification

```
corepack yarn typecheck   # passed, no output
corepack yarn lint        # passed, no output
corepack yarn test        # 7 files, 20 tests passed
```

### Hardening item 3 verification

One-off `tsx -e` check calling `ensureSetupToken` three times with the same env token and a capturing logger destination:

```
{"tokenLogs":1,"totalLogs":1}
```

Confirms the unchanged env token is logged only once. This behavior is verified manually; no automated test was added for it because the review did not request one.

## Concerns after fix

- The setup concurrency race from the original report's concern 2 is resolved by the in-transaction re-check and covered by the new test.
- The original concern about the inert `rateLimit` route config remains: `@fastify/rate-limit` is still not registered in `buildApp` (out of scope for this fix).
- `ensureSetupToken` still intentionally logs the plaintext one-time token when it is first generated or changed; treat production logs as sensitive.
- The test helper still uses the real pino logger at `info` level, so the suite prints request and token warnings by design.
