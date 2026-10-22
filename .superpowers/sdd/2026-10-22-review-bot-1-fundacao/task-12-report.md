# Task 12 Report: Webhooks de saída

## Status
DONE

## What I implemented
- Created `src/webhooks/sign.ts` with `signPayload(secret, body)` using HMAC-SHA256, hex encoded.
- Created `src/webhooks/dispatcher.ts`:
  - `WEBHOOK_EVENTS` / `WebhookEvent` for `review.published`, `job.failed`, `job.partial`, `poller.paused`, `webhook.test`.
  - `DispatchDeps` (`db`, `encryptionKey`, `allowPrivate`, optional `fetchImpl` and `sleep`) and `WebhookRow`.
  - `dispatchToWebhook`: decrypts the stored secret, builds `{ event, timestamp, data }`, signs the exact JSON body with `sha256=<hex>`, sends `x-prreviewer-event` / `x-prreviewer-signature`, and retries 3 times with delays 0/1s/5s. Every attempt is recorded in `webhook_deliveries` (attempt number, success, status code or null on transport error, excerpt capped at 512 chars).
  - `dispatchEvent`: selects enabled webhooks, filters by their `eventsJson`, and dispatches sequentially.
  - `assertSafeUrl` is invoked before every attempt, so SSRF validation happens at delivery time as well as at creation time.
- Created `src/api/routes/webhooks.ts` with `registerWebhookRoutes(app, deps)`, all admin-guarded:
  - `GET /api/webhooks` — public view (never returns the secret).
  - `POST /api/webhooks` — validates URL and events, generates a 32-byte base64url secret when none is supplied, encrypts it with `encryptSecret`, audits `webhook.create`, returns `201 { webhook, secret }` (secret shown once).
  - `PATCH /api/webhooks/:id` — partial update (URL, events, enabled, optional secret rotation), revalidates the URL, audits `webhook.update`.
  - `DELETE /api/webhooks/:id` — `404 webhook_not_found` when missing, cascades deliveries via FK, audits `webhook.delete`, returns `204`.
  - `POST /api/webhooks/:id/test` — dispatches `webhook.test` with `{ message: 'entrega de teste' }` and returns `{ ok }`.
  - `GET /api/webhooks/:id/deliveries` — last 50 deliveries ordered by `createdAt` desc.
- Registered `registerWebhookRoutes(app, deps)` in `src/api/app.ts` after the skills routes.
- Created `tests/unit/webhook-sign.test.ts` (2 tests) and `tests/integration/webhooks.test.ts` (3 tests).

## What I tested and results
- Focused: `corepack yarn test tests/unit/webhook-sign.test.ts tests/integration/webhooks.test.ts` → 2 files / 5 tests passed. The retry test takes ~6.5s because it uses real 1s + 5s waits, as the brief requires.
- `corepack yarn typecheck` → clean (no output, exit 0).
- `corepack yarn lint` → clean (no output, exit 0).
- `corepack yarn test` → 17 files / 68 tests passed, including all pre-existing suites.

Note: global Yarn is 1.22.22 and rejects the project's `packageManager: yarn@4.5.1`; I ran Yarn 4.5.1 through Corepack (`corepack yarn ...`), consistent with the previous task reports. No dependency changes were made.

## TDD evidence

### RED
Command: `corepack yarn test tests/unit/webhook-sign.test.ts tests/integration/webhooks.test.ts` (tests written before implementation)

Result: 2 files failed / 5 tests failed.

Relevant output:

```
FAIL tests/unit/webhook-sign.test.ts
Error: Cannot find module '../../src/webhooks/sign' imported from
'D:/projetos/review-bot/tests/unit/webhook-sign.test.ts'

FAIL tests/integration/webhooks.test.ts > webhooks > cria com secret, testa entrega e lista entregas
AssertionError: expected 404 to be 201 // Object.is equality

FAIL tests/integration/webhooks.test.ts > webhooks > bloqueia URL privada por padrão
AssertionError: expected 404 to be 400 // Object.is equality

FAIL tests/integration/webhooks.test.ts > webhooks > tenta novamente em falha e registra tentativas
TypeError: Cannot read properties of undefined (reading 'id')

Test Files  2 failed (2)
     Tests  3 failed (3)
```

Why expected: `src/webhooks/sign.ts` did not exist, so the unit suite could not even load (module resolution error). The webhook routes were not registered in `buildApp`, so Fastify logged `Route POST:/api/webhooks not found` and answered 404 for create, making the 201 and 400 assertions fail and leaving `created.json().webhook` undefined in the retry test.

### GREEN
Command: `corepack yarn test tests/unit/webhook-sign.test.ts tests/integration/webhooks.test.ts` (after implementation)

```
✓ tests/unit/webhook-sign.test.ts (2 tests) 11ms
✓ tests/integration/webhooks.test.ts (3 tests) 8002ms
  ✓ webhooks > cria com secret, testa entrega e lista entregas 823ms
  ✓ webhooks > bloqueia URL privada por padrão 693ms
  ✓ webhooks > tenta novamente em falha e registra tentativas 6482ms

Test Files  2 passed (2)
     Tests  5 passed (5)
```

Full suite: `Test Files 17 passed (17)`, `Tests 68 passed (68)`.

## Files changed
- `src/webhooks/sign.ts` (new, 5 lines)
- `src/webhooks/dispatcher.ts` (new, 70 lines)
- `src/api/routes/webhooks.ts` (new, 108 lines)
- `src/api/app.ts` (modified: import + `registerWebhookRoutes(app, deps)`)
- `tests/unit/webhook-sign.test.ts` (new, 14 lines)
- `tests/integration/webhooks.test.ts` (new, 55 lines)

## Self-review findings
- Two deliberate deviations from the brief's literal code, both required for the brief's tests to pass:
  1. `assertSafeUrl` throws a plain `Error`, while the shared error handler maps only `AppError`/`ZodError` to 4xx; the private-URL case would therefore have returned 500 instead of the expected 400. I added a small `ensureSafeWebhookUrl` wrapper in the routes file that converts URL-guard failures into `AppError(message, 'invalid_url', 400)`. It is used by create and patch.
  2. Vitest's default per-test timeout is 5s, but the brief's retry test intentionally waits ~6s (1s + 5s). I added a `15000` timeout only to that test; its real-retry behavior is unchanged.
- Otherwise the dispatcher and routes follow the brief verbatim; no comments were added; strict TS/ESM conventions preserved and typecheck/lint are clean.
- The secret is only exposed in the `POST /api/webhooks` response. `toPublic` omits `secretEncrypted`, so list/patch responses never leak it.
- Delivery attempts are persisted synchronously before the next retry, so `/deliveries` reflects partial failure progress (verified: 3 failed rows after the 500 scenario).
- URL validation is performed both on create/update and before each delivery attempt, preventing SSRF even if a row was inserted with a URL that later becomes unsafe.
- Deleting a webhook cascades to its deliveries via the existing FK (`onDelete: 'cascade'` with `foreign_keys = ON`).
- Audit entries for create/update/delete include `userId`, target type/id, URL data on create, and `ip`, consistent with existing admin routes.
- No git repository exists; no commits were made.

## Concerns
- Test coverage matches the brief but does not exercise `GET /api/webhooks`, `PATCH`, `DELETE`, non-admin 403, `enabled: false` filtering, `dispatchEvent`, secret rotation, or re-validation of a URL at dispatch time. The implementation covers these paths, but they rely on the shared guards/error handler rather than dedicated assertions.
- `GET /api/webhooks/:id/deliveries` returns an empty list (200) for an unknown webhook id instead of 404, because the brief's route code does not look up the webhook first.
- `response.text()` reads the whole response body before slicing the excerpt to 512 chars; a very large/hostile response could consume memory. This follows the brief; streaming/truncation could be a future hardening.
- Retries are sequential per webhook and use real timers, so a webhook with a down endpoint can block the caller for ~6s; `dispatchEvent` iterates webhooks sequentially. Acceptable for the current single-process design, but a background queue would be preferable in production.
- DNS is re-resolved on each attempt via `assertSafeUrl`, but the fetch itself can still follow redirects; redirect pinning/TOCTOU remains the deferred concern already noted after Task 8.

---

# Fix report: SSRF via redirects + per-request timeout

## Status
DONE

## Changes
- `src/webhooks/dispatcher.ts`:
  - `fetch` now uses `redirect: 'manual'`, so 3xx responses are no longer followed automatically.
  - Each attempt walks redirects explicitly with a cap of 3 hops (`hop` 0..3). Before every fetch the current URL is revalidated with `assertSafeUrl`, so a `Location` pointing to loopback, RFC1918, link-local/metadata addresses, or a hostname resolving to a private IP is rejected before any request is made.
  - Missing `Location` or a redirect on the last allowed hop throws `Redirecionamento inválido`; the existing catch records the failed attempt.
  - Every fetch now carries `signal: AbortSignal.timeout(10_000)`, enforcing a per-request timeout.
  - The signed body and signature headers are unchanged and re-sent on redirect hops.
- `tests/integration/webhooks.test.ts`: added `não segue redirecionamento para URL privada`. The mocked fetch returns `302` with `location: 'http://127.0.0.1/secret'`; the test asserts the delivery result is `false`, every call targets only the original public URL, every request uses `redirect: 'manual'` and an `AbortSignal`, no call contains `127.0.0.1`, and three failed delivery rows are recorded (one per retry).

## Tests and results

### RED
Command: `corepack yarn test tests/integration/webhooks.test.ts` (new test added, dispatcher not yet fixed)

The new test failed on the missing redirect policy:

```
FAIL tests/integration/webhooks.test.ts > webhooks > não segue redirecionamento para URL privada
AssertionError: expected undefined to be 'manual' // Object.is equality
  expect(init.redirect).toBe('manual');
```

The old code sent no `redirect` option, which is exactly the vulnerability: real `fetch` defaults to `follow`. This run also showed a one-off Vitest 5s timeout on the unrelated first test; it did not reproduce on the subsequent runs (first test took 624ms/1848ms), so it was environmental and not caused by this change. The other three tests passed in the RED run.

### GREEN
Command: `corepack yarn test tests/integration/webhooks.test.ts tests/unit/webhook-sign.test.ts`

```
✓ tests/unit/webhook-sign.test.ts (2 tests)
✓ tests/integration/webhooks.test.ts (4 tests) 13542ms
  ✓ cria com secret, testa entrega e lista entregas 624ms
  ✓ bloqueia URL privada por padrão
  ✓ não segue redirecionamento para URL privada 6334ms
  ✓ tenta novamente em falha e registra tentativas 6298ms

Test Files  2 passed (2)
     Tests  6 passed (6)
```

- `corepack yarn typecheck` → clean (no output, exit 0).
- `corepack yarn lint` → clean (no output, exit 0).
- `corepack yarn test` → `Test Files 17 passed (17)`, `Tests 69 passed (69)` (68 previous + the new redirect test).

## Concerns
- DNS-rebinding TOCTOU remains: `assertSafeUrl` resolves the hostname and the subsequent fetch resolves it again, so a hostile DNS answer could change between validation and connection. The controller accepted this as documented residual risk for admin-configured webhook URLs; no undici pinning/dispatcher swap was attempted in this fix.
- The 10s timeout applies per fetch. A delivery can therefore take up to 4 × 10s across redirect hops per attempt, on top of the 0/1s/5s retry delays; the worst case is longer than the previous single-request timeout. This matches the requested shape; a total-delivery deadline could be added later.
- Redirect responses are not explicitly body-drained before the next hop (`response.text()` is only called for the final response). With real undici fetch and `redirect: 'manual'`, an unconsumed body on a discarded hop may delay socket reuse; no functional impact was observed in tests, but draining small redirect bodies could be considered as hardening.
- Up to 4 signed POSTs can be sent per attempt when redirects are public; each hop is SSRF-validated, but a public redirect target still receives the payload and signature. This is inherent to supporting redirects at all; the hop cap bounds it.
- The redirect test takes ~6.3s for the same reason as the existing retry test (real 1s + 5s retry waits) and keeps the 15s per-test timeout.
- No git repository exists; no commits were made.
