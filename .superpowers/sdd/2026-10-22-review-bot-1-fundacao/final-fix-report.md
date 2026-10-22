# Final review fixes — 2026-10-22

## Changes

### 1. AI profile test SSRF hardening
- `src/ai/profiles.ts`
  - `ProfileInput.baseUrl` now requires an `http(s)` URL via `.refine`.
  - `testProfile` signature changed to `(db, encryptionKey, id, options = { allowPrivate: false }, fetchImpl?)`.
  - It honors `options.allowPrivate`, uses `assertSafeUrl` with the deployment flag, and wraps URL/guard failures in `AppError('invalid_base_url', 400)`.
- `src/api/routes/ai-profiles.ts`
  - `/api/ai-profiles/:id/test` now passes `{ overrideApiKey: body.apiKey, allowPrivate: deps.config.ALLOW_PRIVATE_URLS }`.
- `src/ai/adapters/openai-compatible.ts`, `src/ai/adapters/anthropic.ts`
  - `testConnection` fetches now use `redirect: 'error'` and `signal: AbortSignal.timeout(30_000)`.

### 2. Atomic profile/skill writes and duplicate prevention
- `src/ai/profiles.ts`
  - `skillIds` now rejects duplicates through `.refine`.
  - `createProfile` validates skills/name before the transaction, then inserts the profile and all `aiProfileSkills` rows inside one `db.transaction`.
  - `updateProfile` performs the update, link deletion, and new link inserts inside one `db.transaction`.
  - Removed the standalone `setSkillLinks` helper.
  - A link-insert failure rolls back the profile row; no orphan links or partial profiles remain.

### 3. Deleting profiles with jobs
- `src/db/schema.ts`: `jobs.profileId` now references `aiProfiles.id` with `onDelete: 'set null'`.
- Generated `drizzle/0001_sticky_black_bird.sql` via `yarn db:generate`. The migration rebuilds `jobs` with the new FK action and preserves data with `INSERT ... SELECT`.
- Test helper `runMigrations(db, 'drizzle')` applies the new migration successfully (all integration tests passed).

### 4. Fastify 4xx mapping
- `src/api/app.ts`: after `AppError`, `ZodError`, and 429 handling, Fastify errors with `statusCode` 400–499 now return `errorBody('bad_request', message)` with the original status code. The message uses `error instanceof Error ? error.message : 'Requisição inválida'` to satisfy TypeScript's `unknown` narrowing.

### 5. Tests
- `tests/integration/ai-profiles.test.ts`
  - Added non-http(s) `baseUrl` rejection.
  - Added duplicate `skillIds` rejection (skill `s1` inserted first).
  - Added unknown skill rejection with assertion that no profile row exists.
  - Added private literal base URL test: `ALLOW_PRIVATE_URLS` false → 400 `invalid_base_url`, fetch not called.
  - Added `ALLOW_PRIVATE_URLS` true → 200 and fetch called once.
  - Existing test now enables `ALLOW_PRIVATE_URLS` for its stubbed provider test.
- `tests/unit/adapters.test.ts`
  - Asserts `redirect: 'error'` and a non-undefined `AbortSignal` for both adapters.
- `tests/integration/health.test.ts`
  - Added malformed JSON login test → 400 `{ error: { code: 'bad_request' } }`.

## Migration file
- `drizzle/0001_sticky_black_bird.sql`
- `drizzle/meta/_journal.json` and `drizzle/meta/0001_snapshot.json` updated by the generator.

## Verification
- `yarn test tests/integration/ai-profiles.test.ts tests/unit/adapters.test.ts tests/integration/health.test.ts` — 3 files, 14 tests passed.
- `yarn typecheck` — clean.
- `yarn lint` — clean.
- `yarn test` — 25 files, 90 tests passed (66.31s, `fileParallelism: false`).
- `yarn build` — Vite and tsup builds succeeded.

## Concerns
- The `ALLOW_PRIVATE_URLS: true` integration test mutates `deps.config.ALLOW_PRIVATE_URLS` after `buildApp`; the route reads the config at request time, so this reflects deployment behavior, but it is a test-only override rather than a separately constructed app.
- The migration rebuilds the `jobs` table, which SQLite requires for an FK action change. It preserves rows, but on large production databases the operation will lock the table while copying.
- Skill validation remains outside the transaction by design (as requested). If a skill is deleted between validation and linking, the FK failure rolls back the whole transaction, leaving no partial state.

## Data-loss migration fix — 2026-10-22

### Changes
- `src/db/schema.ts`: reverted `jobs.profileId` to `text('profile_id').references(() => aiProfiles.id)` without `onDelete`.
- `src/ai/profiles.ts`: `deleteProfile` now clears `jobs.profileId` for the profile and deletes the profile inside one `db.transaction`, keeping jobs and their history intact. Imports `jobs` from `../db/schema`.
- `tests/integration/ai-profiles.test.ts`: added a test that creates a profile (API), repository and job (DB), calls `deleteProfile` with the test DB, then asserts the profile is gone, the job still exists and `job.profileId` is null. The active-profile test now also asserts the `active_profile` error code.

### Migration cleanup
- Deleted `drizzle/0001_sticky_black_bird.sql` and `drizzle/meta/0001_snapshot.json`.
- `drizzle/meta/_journal.json` now contains only the `0000_romantic_carmella_unuscione` entry.
- No source, test, config or journal file references the removed migration. Only historical prose (this report and the next-phase plan placeholder `drizzle/0001_*.sql`) mentions `0001`; the plan placeholder remains valid because the next generated migration will use index 0001.
- `tests/unit/db.test.ts` still applies the remaining migration from scratch on an in-memory DB.

### Verification
- `yarn test tests/integration/ai-profiles.test.ts` — 10 tests passed.
- `yarn typecheck` — clean.
- `yarn lint` — clean.
- `yarn test` — 25 files, 91 tests passed (65.38s, `fileParallelism: false`).
- `yarn build` — Vite and tsup succeeded.

### Concerns
- `deleteProfile` relies on application-level cleanup. Direct SQL deletes or any future code path that deletes `ai_profiles` without clearing `jobs.profile_id` will fail with the `NO ACTION` FK while related jobs exist; all profile deletion must go through the service.
- The earlier concern about the `jobs` table rebuild no longer applies: migration 0001 was removed, so no destructive rebuild ships.
