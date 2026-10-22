# Task 10 Report: Adaptadores de IA e perfis

## What I implemented

- `src/ai/adapters/types.ts`: `ProviderKind`, `TestConnectionInput`, `ProviderAdapter`, and `excerpt` helper (collapses whitespace, truncates to 200 chars).
- `src/ai/adapters/openai-compatible.ts`: adapter that POSTs to `<baseUrl>/chat/completions` (idempotent when the URL already ends in `/chat/completions`) with Bearer auth and a one-token ping, throwing `AppError('provider_test_failed', 400)` with the provider status and response excerpt on failure.
- `src/ai/adapters/anthropic.ts`: adapter that POSTs to `<baseUrl>/v1/messages` (handles root, `/v1`, and `/v1/messages` base URLs), sends `x-api-key` + `anthropic-version: 2023-06-01`, same error behavior.
- `src/ai/adapters/index.ts`: `getAdapter(kind)` registry keyed by `ProviderKind`.
- `src/ai/profiles.ts`: Zod `ProfileInput` (name/provider/baseUrl/model/apiKey and all limit defaults: temperature 0.2, maxOutputTokens 4096, maxTurns 20, maxTotalTokens 200000, maxDurationSec 600, maxFindings 25, maxGithubCalls 80, prePrompt, skillIds); public projection that strips `apiKeyEncrypted` and exposes `hasApiKey` + ordered `skillIds`; `listProfiles`, `getProfileRow`, `createProfile` (encrypts key, requires it, enforces unique name, validates skills and 128 KB prompt budget), `updateProfile` (keeps existing ciphertext when `apiKey` is omitted, replaces skill links), `deleteProfile` (blocks active profile), `activateProfile` (single active profile), `testProfile` (decrypts or uses override key, `assertSafeUrl(..., { allowPrivate: true })`, dispatch to adapter), and `getActiveProfile` (returns row plus decrypted key).
- `src/api/routes/ai-profiles.ts`: admin-only CRUD, activate, and test endpoints with Zod parsing and audit entries for create/update/delete/activate.
- `src/api/app.ts`: registers `registerAiProfileRoutes(app, deps)` in `buildApp`.
- `tests/unit/adapters.test.ts` and `tests/integration/ai-profiles.test.ts`: copied verbatim from the brief.

No code comments were added; ESM and strict TS conventions of the repo were followed. No git repository exists, so nothing was initialized or committed.

## What I tested and results

- Focused: `corepack yarn test tests/unit/adapters.test.ts tests/integration/ai-profiles.test.ts` -> 2 files, 7 tests passed (3 adapter unit tests, 4 profile integration tests).
- `corepack yarn typecheck` -> exit 0, no output.
- `corepack yarn lint` -> exit 0, no output.
- Full: `corepack yarn test` -> 14 files, 59 tests passed.

Note: the globally installed `yarn` is 1.22.22 and refuses this project's `packageManager: yarn@4.5.1`; I used `corepack yarn ...`, which resolves the pinned Yarn 4.5.1.

## TDD evidence

### RED

Command:

```
corepack yarn test tests/unit/adapters.test.ts tests/integration/ai-profiles.test.ts
```

Result: 2 files failed, 4 integration tests failed.

```
FAIL tests/unit/adapters.test.ts [ tests/unit/adapters.test.ts ]
Error: Cannot find module '../../src/ai/adapters' imported from 'D:/projetos/review-bot/tests/unit/adapters.test.ts'

× perfis de IA > cria, mascara a chave, ativa e testa
  → expected 404 to be 201 // Object.is equality
× perfis de IA > mantém a chave quando o update não envia apiKey
  → Cannot read properties of undefined (reading 'id')
× perfis de IA > não remove o perfil ativo
  → Cannot read properties of undefined (reading 'id')
× perfis de IA > valida limites
  → expected 404 to be 400 // Object.is equality

Test Files  2 failed (2)
     Tests  4 failed (4)
```

Why this was expected: no `src/ai/adapters` module existed, so the unit suite could not even load; and `buildApp` did not register AI profile routes, so every request returned 404, causing the 201/400 expectations and the `profile.id` accesses to fail. This proves the tests exercise the not-yet-written feature rather than existing code.

### GREEN

Command:

```
corepack yarn test tests/unit/adapters.test.ts tests/integration/ai-profiles.test.ts
```

Result:

```
✓ tests/unit/adapters.test.ts (3 tests) 62ms
✓ tests/integration/ai-profiles.test.ts (4 tests) 1465ms
  ✓ perfis de IA > cria, mascara a chave, ativa e testa
  ✓ perfis de IA > mantém a chave quando o update não envia apiKey
  ✓ perfis de IA > não remove o perfil ativo
  ✓ perfis de IA > valida limites

Test Files  2 passed (2)
     Tests  7 passed (7)
```

Full suite after implementation:

```
Test Files  14 passed (14)
     Tests  59 passed (59)
```

## Files changed

Created:
- `src/ai/adapters/types.ts`
- `src/ai/adapters/openai-compatible.ts`
- `src/ai/adapters/anthropic.ts`
- `src/ai/adapters/index.ts`
- `src/ai/profiles.ts`
- `src/api/routes/ai-profiles.ts`
- `tests/unit/adapters.test.ts`
- `tests/integration/ai-profiles.test.ts`

Modified:
- `src/api/app.ts` (import + registration of `registerAiProfileRoutes`)

## Self-review findings

- Implementation matches the brief's code and exported interfaces; all requested symbols are present (`ProviderKind`, `ProviderAdapter`, `getAdapter`, `ProfileInput`, `ProfileInputType`, `PublicProfile`, `toPublicProfile`, `listProfiles`, `getProfileRow`, `createProfile`, `updateProfile`, `deleteProfile`, `activateProfile`, `testProfile`, `getActiveProfile`).
- API keys never leave the server: `toPublicProfile` strips `apiKeyEncrypted`, replaces it with `hasApiKey`, and the integration test asserts the response body does not contain the plaintext key. Keys are stored via `encryptSecret` (AES-256-GCM v1 payload).
- Skill association ordering is preserved through `position` and replaced on update (delete + reinsert); skill existence and the 128 KB combined prompt/skill budget are validated before writes.
- Unique profile name is enforced both by a pre-check (409) and the DB unique index; the active profile cannot be deleted (409); activation keeps exactly one active row inside a transaction.
- Limit validation is effective end-to-end: `temperature: 5` produced a 400 via the app's `ZodError` handler.
- Adapter URL builders handle trailing slashes and already-suffixed URLs, and error messages include provider status plus a whitespace-normalized 200-char excerpt.
- `testProfile` deliberately passes `allowPrivate: true` per the task context so local providers (Ollama/LM Studio) work; the URL guard still restricts to http/https.
- `typecheck` with `strict` + `noUncheckedIndexedAccess` and ESLint both pass; existing 52 tests still pass.
- I did not add any code comments, extra dependencies, or unrelated changes.

## Concerns

- `assertSafeUrl` throws a plain `Error` for non-http(s) schemes, so a profile with e.g. `ftp://...` that passes `z.string().url()` would return 500 `internal_error` from `/test` instead of a 400. The brief explicitly specifies this code and notes only that non-http schemes are rejected; wrapping it in an `AppError` (400) would be a small follow-up.
- `createProfile`/`updateProfile` commit the profile row before `setSkillLinks` runs outside that transaction, so an unexpected failure while writing links could leave a profile without its skills. Skill validation happens beforehand, making this low risk; folding link writes into the same transaction would harden it.
- `listProfiles` performs one skills query per profile (N+1). Acceptable for an admin-managed table expected to stay small, but worth revisiting if profile counts grow.
- `z.string().url()` alone does not restrict protocols at save time; only the test endpoint validates via `assertSafeUrl`. Plan 2's review-time URL policy (`ALLOW_PRIVATE_URLS`) remains the primary SSRF control.
- The `/test` endpoint is not audited (create/update/delete/activate are), matching the brief.
