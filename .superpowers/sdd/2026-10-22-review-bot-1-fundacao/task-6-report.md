# Task 6 Report: Sessões, login, guards e plugins de segurança

## Status: DONE_WITH_CONCERNS

## What I implemented

- **Sessions** (`src/auth/sessions.ts`): hashed opaque token sessions (SHA-256 via `hashToken`), 12h sliding idle expiry, 7d absolute expiry, UUIDv7 session ids, session destroy/revoke, expired-session purge, and `prr_session` cookie helpers (httpOnly, SameSite=Lax, secure only in production with an HTTPS `PUBLIC_URL`, 12h maxAge).
- **Guards** (`src/auth/guards.ts`): `requireAuth(deps)` and `requireRole(deps, ...roles)` preHandlers throwing `AppError` 401/403. Request augmentation in `src/types/fastify.d.ts` (`user`, `sessionToken`).
- **Security plugin** (`src/api/plugins/security.ts`): `@fastify/cookie`, `@fastify/helmet` (CSP only in production), `@fastify/rate-limit` with `global: false`, and a global `onRequest` Origin allow-list check for POST/PUT/PATCH/DELETE. Exported pure `isAllowedOrigin`.
- **Auth routes** (`src/api/routes/auth.ts`): `POST /api/auth/login` (normalized username, disabled-user rejection, argon2 verify, `lastLoginAt`, 5/min/IP+username rate limit), `POST /api/auth/logout` (204 + cookie clear), `GET /api/auth/me`, `POST /api/auth/password` (current-password check, rehash, revoke all sessions, issue a fresh session).
- **App** (`src/api/app.ts`): `buildApp` is now `async`, registers the security plugin before routes, registers auth routes, and maps rate-limit 429 errors to `rate_limited` instead of 500.
- **Setup auto-login** (`src/api/routes/setup.ts`): after `completeSetup`, creates a session and sets the session cookie before returning 201.
- **Test infrastructure**: `createTestApp` is now async and returns `{ app, deps }`; `tests/helpers/auth.ts` adds `setupRootAndLogin`; health/setup tests await the helper.
- **Tests added**: origin unit tests and auth integration tests (login/me/logout, invalid credentials, unauthenticated access, password-change revocation, cross-origin mutation rejection, login rate limiting).

## What I tested and results

- Focused: `corepack yarn test tests/unit/origin.test.ts tests/integration/auth.test.ts tests/integration/setup.test.ts` — 3 files, 14 tests passed (before adding the rate-limit test).
- Focused after rate-limit fix: `corepack yarn test tests/integration/auth.test.ts` — 1 file, 6 tests passed.
- Full suite: `corepack yarn test` — **9 files, 30 tests passed**.
- `corepack yarn typecheck` — exit 0.
- `corepack yarn lint` — exit 0.
- Manual integration probe: 6 invalid logins for one username returned `401,401,401,401,401,429` after the fix (before the fix the sixth returned 500).

Note: the globally installed `yarn` is 1.22.22 while the project pins `packageManager: yarn@4.5.1`; I invoked the pinned version with `corepack yarn` (4.5.1). No pnpm used.

## TDD evidence

### RED 1 — new security module missing

Command:

```
corepack yarn test tests/unit/origin.test.ts tests/integration/auth.test.ts
```

Result:

```
FAIL tests/unit/origin.test.ts
Error: Cannot find module '../../src/api/plugins/security' imported from 'D:/projetos/review-bot/tests/unit/origin.test.ts'

FAIL tests/integration/auth.test.ts (5 tests | 5 failed)
× faz login, retorna me e faz logout
  → login falhou: {"message":"Route POST:/api/auth/login not found","error":"Not Found","statusCode":404}
× bloqueia acesso sem sessão → expected 404 to be 401
× rejeita origem cruzada em mutações → expected 404 to be 403
```

Expected failure: the security plugin file did not exist and none of the `/api/auth/*` routes were registered yet, so the new tests failed for missing functionality rather than typos.

### RED 2 — rate limiting returned 500

After the first GREEN, a manual probe showed the 6th login attempt returned 500. I added a test to `tests/integration/auth.test.ts` and watched it fail:

Command:

```
corepack yarn test tests/integration/auth.test.ts -t "limita tentativas de login"
```

Result:

```
× autenticação > limita tentativas de login
  → expected [ 401, 401, 401, 401, 401, 500 ] to deeply equal [ 401, 401, 401, 401, 401, 429 ]
```

Expected failure: `@fastify/rate-limit` throws a plain `Error` with `statusCode: 429`; the custom error handler treated it as unknown and returned 500. The assertion encodes the intended 429 behaviour.

### GREEN

Command:

```
corepack yarn test tests/unit/origin.test.ts tests/integration/auth.test.ts tests/integration/setup.test.ts
```

Result:

```
✓ tests/unit/origin.test.ts (4 tests)
✓ tests/integration/setup.test.ts (5 tests)
✓ tests/integration/auth.test.ts (5 tests)
Test Files 3 passed (3)
Tests 14 passed (14)
```

After the rate-limit fix:

```
corepack yarn test tests/integration/auth.test.ts
✓ tests/integration/auth.test.ts (6 tests)
Test Files 1 passed (1)
Tests 6 passed (6)
```

Final full run:

```
corepack yarn test
Test Files 9 passed (9)
Tests 30 passed (30)
```

## Files changed

Created:

- `src/auth/sessions.ts`
- `src/auth/guards.ts`
- `src/types/fastify.d.ts`
- `src/api/plugins/security.ts`
- `src/api/routes/auth.ts`
- `tests/helpers/auth.ts`
- `tests/integration/auth.test.ts`
- `tests/unit/origin.test.ts`

Modified:

- `src/api/app.ts` (async `buildApp`, security/auth registration, 429 mapping)
- `src/api/routes/setup.ts` (auto-login session + cookie)
- `tests/helpers/app.ts` (async `createTestApp` returning `{ app, deps }`)
- `tests/integration/health.test.ts` (await async helper)
- `tests/integration/setup.test.ts` (await async helper)

## Self-review findings

1. **Brief bug fixed:** the brief's `src/api/routes/auth.ts` used `FastifyRequest` in the rate-limit `keyGenerator` without importing it. Added `FastifyRequest` to the existing `fastify` type import; otherwise `tsc --noEmit` fails.
2. **Helper typing:** `tests/helpers/app.ts` now imports `FastifyInstance` explicitly because `buildApp` returns `Promise<FastifyInstance>` (the brief snippet omitted the import).
3. **Rate-limit 429 bug found and fixed:** the pre-existing custom error handler converted rate-limit errors to 500. Added a targeted `statusCode === 429` branch in `src/api/app.ts` returning `rate_limited`, plus a regression test in the allowed auth test file. Verified by RED → GREEN.
4. **Async helper migration complete:** `grep` confirms no remaining synchronous `createTestApp()` call sites in health/setup tests; all use `await`.
5. **No comments** were added; strict TypeScript and ESM conventions preserved. `typecheck` and `lint` both exit 0.
6. **Cookie/session flow verified end-to-end:** setup returns 201 and sets a session cookie; login/me/logout work with the cookie; password change revokes the old cookie (401) and issues a new session; login with the new password succeeds.

## Concerns

1. **Idle expiry vs. cookie lifetime:** the server slides `idleExpiresAt` on every request, but the cookie's `maxAge` stays fixed at 12h from issue time. An actively used session therefore drops in the browser after 12h even though the server would allow up to 7d absolute. This matches the brief exactly, but reissuing the cookie near expiry would be needed for true sliding idle sessions.
2. **`requireRole` is untested and unused:** no route consumes it yet and the brief specified no dedicated test file; it typechecks but its runtime behaviour is not exercised.
3. **`purgeExpiredSessions` is not scheduled:** it exists and is exported, but nothing calls it (expected to be wired into a maintenance/cleanup task later).
4. **Other 4xx Fastify errors still map to 500:** only 429 was special-cased. Pre-existing behaviour for malformed JSON (400) and similar client errors remains 500; outside this task's scope but worth fixing in the error-handling task.
5. **In-memory rate-limit store:** `@fastify/rate-limit` uses its default local store. A multi-instance deployment would need a shared store; per-process limits only for now.
6. **Test helper cookie name is a literal:** `tests/helpers/auth.ts` hardcodes `prr_session` as specified by the brief instead of importing `SESSION_COOKIE`; minor duplication only.

---

# Fix Report — Task Review Follow-up

## Important 1 — fixed 12h cookie defeated sliding idle / 7d absolute

### Changes

- `src/auth/sessions.ts`
  - `resolveSession` now returns `{ user: PublicUser; absoluteExpiresAt: number } | undefined`, including `row.absoluteExpiresAt`.
  - `setSessionCookie(reply, token, config, absoluteExpiresAt?)` computes
    `remaining = (absoluteExpiresAt ?? now + ABSOLUTE_MS) - now` and sets
    `maxAge: Math.max(60, Math.floor(Math.min(IDLE_MS, remaining) / 1000))`.
- `src/auth/guards.ts`
  - `requireAuth` is now `async (request, reply)`. After a successful resolve it refreshes the cookie with
    `setSessionCookie(reply, token, deps.config, resolved.absoluteExpiresAt)`. When a token is present but
    invalid/expired it calls `clearSessionCookie(reply)` before throwing 401.
  - `requireRole` forwards `reply` to `auth(request, reply)`.
  - No-token requests still throw `unauthenticated` without setting a clearing cookie.

Result: every authenticated request reissues `prr_session` with maxAge capped by the session's absolute expiry,
so the browser cookie can slide with activity up to the 7-day absolute limit instead of dying at 12h.

## Important 2 — rate-limit key used raw username

### Change

- `src/api/routes/auth.ts`: the login `keyGenerator` now parses the body with `LoginBody.safeParse`, lowercases
  and truncates the username to 64 chars, and falls back to `invalid` on parse failure. `root`, `ROOT`, `Root`,
  etc. now share one bucket per IP.

## Covering tests added (`tests/integration/auth.test.ts`)

1. `renova o cookie em requisições autenticadas` — login, then `GET /api/auth/me`; asserts a `Set-Cookie` with
   `prr_session=` and `HttpOnly` is returned.
2. `aplica o limite a variantes de maiúsculas do usuário` — 5 failed logins alternating `root`/`ROOT` variants,
   each 401, then a 6th any-case attempt returns 429.
3. `rejeita e limpa sessão expirada` — login, then update that session row's `absolute_expires_at` to the past
   (looked up by `sessions.tokenHash` with `hashToken(token)` and `eq`), call `/api/auth/me`, assert 401 and a
   clearing `Set-Cookie` (`max-age=0`).

## TDD evidence

### RED

Command:

```
corepack yarn test tests/integration/auth.test.ts
```

Result (expected failures: no cookie refresh, raw-case buckets, no clearing cookie):

```
× autenticação > renova o cookie em requisições autenticadas
  → expected undefined to be truthy   (no Set-Cookie on /api/auth/me)
× autenticação > aplica o limite a variantes de maiúsculas do usuário
  → expected 401 to be 429
× autenticação > rejeita e limpa sessão expirada
  → expected undefined to be truthy   (401 but no clearing Set-Cookie)

Test Files 1 failed (1)
Tests 3 failed | 6 passed (9)
```

### GREEN

Focused command:

```
corepack yarn test tests/integration/auth.test.ts
```

```
✓ tests/integration/auth.test.ts (9 tests)
Test Files 1 passed (1)
Tests 9 passed (9)
```

Final verification:

```
corepack yarn typecheck   → exit 0
corepack yarn lint        → exit 0
corepack yarn test        → Test Files 9 passed (9), Tests 33 passed (33)
```

## Files changed in this fix

- `src/auth/sessions.ts`
- `src/auth/guards.ts`
- `src/api/routes/auth.ts`
- `tests/integration/auth.test.ts`
- `task-6-report.md` (this append)

## Fix self-review / remaining concerns

1. Cookie refresh now happens on every authenticated request, including logout and password change. Because
   `@fastify/cookie` stores pending cookies by name/domain/path, the subsequent `clearCookie` (logout) or new
   session cookie (password change) overwrites the refreshed cookie, so each response carries the correct final
   cookie only. Covered by the existing logout and password-change tests.
2. The 60-second minimum maxAge can leave a cookie in the browser up to 60s past absolute expiry when a session
   has <60s left. The server still rejects it (`resolveSession` checks `absoluteExpiresAt`), so this is cosmetic
   only and matches the required formula.
3. `requireRole` still has no direct test/consumer; it now forwards `reply` as required but remains unexercised.
4. Other non-429 Fastify 4xx errors still map to 500 (pre-existing, outside this fix).
5. The rate-limit store remains per-process/in-memory; multi-instance deployments need a shared store.
6. Login bodies are parsed twice per request (once in the rate-limit key generator, once in the handler);
   negligible cost and keeps the normalized key logic local to the route.
