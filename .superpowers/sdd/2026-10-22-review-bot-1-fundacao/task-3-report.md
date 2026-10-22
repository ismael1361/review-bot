# Task 3 Report: Banco, schema completo, migrations e settings

## What I implemented

- `drizzle.config.ts`: drizzle-kit config for the SQLite dialect, pointing at `src/db/schema.ts` with migrations output in `./drizzle`.
- `src/db/schema.ts`: all 17 tables from the brief verbatim — `users`, `sessions`, `app_settings`, `github_credentials`, `ai_profiles`, `skills`, `ai_profile_skills`, `repositories`, `jobs`, `reviews`, `review_findings`, `agent_messages`, `events`, `webhooks`, `webhook_deliveries`, `audit_log`, `github_cache` — including every declared unique index, regular index, composite primary key, foreign key action, default and enum.
- `src/db/client.ts`: `Db` type plus `createDb(path)` creating a `better-sqlite3` connection with `foreign_keys = ON`, `busy_timeout = 5000`, and WAL for file-backed databases.
- `src/db/migrate.ts`: `runMigrations(db, folder)` wrapping Drizzle's better-sqlite3 migrator.
- `src/db/settings.ts`: `getSetting<T>`, `setSetting` (upsert via `onConflictDoUpdate`) and `deleteSetting` over `app_settings`, JSON-encoding values.
- `tests/helpers/db.ts`: `createTestDb()` using an in-memory database and running the real generated migrations.
- `tests/unit/db.test.ts`: tests for settings get/set/overwrite/delete and for the unique username constraint.
- Generated migration `drizzle/0000_romantic_carmella_unuscione.sql` plus `drizzle/meta/0000_snapshot.json` and `drizzle/meta/_journal.json` via `yarn db:generate`.

All implementation and test code matches the brief verbatim; no comments were added.

## What I tested and results

- `corepack yarn db:generate` — generated `drizzle/0000_romantic_carmella_unuscione.sql`, `drizzle/meta/0000_snapshot.json` and `drizzle/meta/_journal.json`; drizzle-kit reported 17 tables with the expected columns/indexes/FKs.
- `corepack yarn vitest run tests/unit/db.test.ts` — 2/2 tests passed.
- `corepack yarn typecheck` — passed (exit 0, no output).
- `corepack yarn lint` — passed (exit 0, no output).
- `corepack yarn test` — 4 test files, 8/8 tests passed (db 2, config 4, logger 1, health 1).

Yarn was run through Corepack because the globally installed `yarn` is 1.22.22, while the project pins Yarn 4.5.1 via `packageManager`.

## TDD evidence

### RED

Command: `corepack yarn vitest run tests/unit/db.test.ts`

Output (excerpt):

```
FAIL  tests/unit/db.test.ts [ tests/unit/db.test.ts ]
Error: Cannot find module '../../src/db/client' imported from 'D:/projetos/review-bot/tests/helpers/db.ts'
 ❯ tests/helpers/db.ts:1:1
Caused by: Error: Failed to load url ../../src/db/client ... Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

Why expected: the test and `createTestDb` helper were written before any `src/db/*` modules existed, so importing `createDb`/`runMigrations` must fail with "Cannot find module". The failure is caused by the missing feature (DB layer), not by a typo in the test.

### GREEN

Command: `corepack yarn vitest run tests/unit/db.test.ts`

Output:

```
 ✓ tests/unit/db.test.ts (2 tests) 43ms
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Full checkpoint: `corepack yarn test` → 4 files / 8 tests passed; typecheck and lint exited 0 with no output.

## Files changed

- Created `drizzle.config.ts`
- Created `src/db/schema.ts`
- Created `src/db/client.ts`
- Created `src/db/migrate.ts`
- Created `src/db/settings.ts`
- Created `tests/helpers/db.ts`
- Created `tests/unit/db.test.ts`
- Created `drizzle/0000_romantic_carmella_unuscione.sql` (generated)
- Created `drizzle/meta/0000_snapshot.json` (generated)
- Created `drizzle/meta/_journal.json` (generated)

No other files were modified. No git repository was initialized or committed.

## Self-review findings

- Schema completeness: all 17 tables and all columns from the brief are present; `drizzle-kit generate` confirms 17 tables, 23 columns in `jobs`, and the expected FK/index counts.
- Indexes/uniques: every named index and unique index in the brief appears in the generated SQL (`users_username_unique`, `sessions_token_unique`, `sessions_user`, `ai_profiles_name_unique`, `skills_name_unique`, repository uniques, `jobs_unique_run`, `jobs_status_queued`, `reviews_job_unique`, `findings_job_status`, `agent_messages_job_seq`, `events_job_created`, `webhook_deliveries_webhook_created`, `audit_log_created`) plus the composite PK on `ai_profile_skills`.
- Foreign keys: cascade/set-null/no-action behavior matches the brief (`sessions.user_id` cascade, `review_findings.review_id` set null, `audit_log.user_id` set null, job-owned children cascade, etc.).
- Defaults: booleans, counters and `side = 'RIGHT'` are emitted in the migration as declared.
- Tests assert real behavior through the real SQLite engine and real migrations: settings upsert changes type/value, delete removes the row, and a duplicate username is rejected by the unique index.
- No comments are present in the new source/test files.
- `corepack yarn typecheck` with `strict` and `noUncheckedIndexedAccess` passes, so all schema types and Drizzle APIs are sound.

## Concerns

- `tests/helpers/db.ts` passes the relative folder `'drizzle'` to `runMigrations`, so tests depend on being run from the project root (true for Vitest here, but brittle if the working directory changes).
- Enum values and boolean columns are enforced only by TypeScript/Drizzle; the generated SQLite schema has no CHECK constraints for them (matches the brief's schema).
- There is no dedicated test for FK cascade behavior or every table's constraints; coverage is the brief's two behavior tests plus migration execution through `createTestDb`.
