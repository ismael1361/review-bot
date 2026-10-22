# Task 13 Report: Repositórios, fila (somente leitura), configurações do sistema, dashboard e SSE

## Status
DONE

## What I implemented
- Created `src/events/bus.ts` with `BusEvent`, `EventBus`, and `createEventBus()`: an in-memory listener `Set` with `publish`/`subscribe`; `subscribe` returns an unsubscribe function.
- Created `src/api/routes/repositories.ts`:
  - `GET /api/repositories` (viewer/operator/admin) lists all repositories.
  - `PATCH /api/repositories/:id` (admin) toggles `enabled`, bumps `updatedAt`, returns `404 repository_not_found` for an unknown id.
- Created `src/api/routes/jobs-read.ts`:
  - `GET /api/jobs` (viewer/operator/admin) with optional `status`/`repositoryId` filters and `page`/`limit` pagination (limit 1..100, default 20), ordered by `queuedAt` desc; returns `{ jobs, total, page, limit }`.
  - `GET /api/reviews` (viewer/operator/admin) with `page`/`limit`, ordered by `postedAt` desc; returns `{ reviews, total, page, limit }`.
- Created `src/api/routes/queue.ts`:
  - `GET /api/queue` returns queued/running counts and `paused` from the `queue_paused` setting.
  - `POST /api/queue/pause` and `POST /api/queue/resume` (operator/admin) persist the setting, write an audit entry (`queue.pause` / `queue.resume`), publish `queue.updated` on the bus, and return `{ paused }`.
  - Exported `isQueuePaused(db)` for future worker consumption.
- Created `src/api/routes/settings-system.ts`:
  - `SystemSettings` zod schema with defaults: `pollingIntervalSec` 60 (30..3600), `retentionDays` 90 (1..3650), `concurrency` 1 (1..3), `ignoreDrafts` false, `skipOwnPrs` true.
  - `getSystemSettings(db)` parses stored settings merged with defaults.
  - `GET/PUT /api/settings/system` (admin); PUT persists, audits `system_settings.update`, and returns the parsed body.
- Created `src/api/routes/dashboard.ts`: `GET /api/dashboard` (viewer/operator/admin) returns queued/running job counts, total and last-24h review counts, and failed job count.
- Created `src/api/routes/events.ts`: `GET /api/events` (viewer/operator/admin) hijacks the reply, writes SSE headers plus `: connected`, subscribes to the bus (`event:`/`data:` frames), sends a 25s heartbeat comment, and unsubscribes/clears the interval on request close.
- Modified `src/api/app.ts`: added `bus: EventBus` to `AppDeps` and registered the six new route groups after webhooks.
- Modified `tests/helpers/app.ts`: `createTestDeps()` now includes `bus: createEventBus()`.
- Created `tests/unit/bus.test.ts` (delivery + unsubscribe).
- Created `tests/integration/events.test.ts` (real ephemeral listener, `: connected` chunk, bus publish, event chunk, abort/close).
- Created `tests/integration/dashboard.test.ts` with the two brief tests plus two additional tests covering the otherwise untested read routes: repository list/toggle/404 and jobs/reviews listing with pagination.

## What I tested and results
- Focused: `corepack yarn test tests/unit/bus.test.ts tests/integration/events.test.ts tests/integration/dashboard.test.ts` -> 3 files / 6 tests passed.
- `corepack yarn typecheck` -> clean (no output, exit 0).
- `corepack yarn lint` -> clean (no output, exit 0).
- Full suite: `corepack yarn test` -> 20 files / 75 tests passed, including all pre-existing suites.

Note: global Yarn is 1.22.22 and rejects the project's `packageManager: yarn@4.5.1`; Yarn 4.5.1 was run through Corepack (`corepack yarn ...`), consistent with previous task reports. No dependency changes were made.

## TDD evidence

### RED 1 - EventBus
Command: `corepack yarn test tests/unit/bus.test.ts` (test written before `src/events/bus.ts` existed)

```
FAIL tests/unit/bus.test.ts [ tests/unit/bus.test.ts ]
Error: Cannot find module '../../src/events/bus' imported from
'D:/projetos/review-bot/tests/unit/bus.test.ts'
...
Test Files  1 failed (1)
     Tests  no tests
```

Why expected: the bus module did not exist, so the suite could not load. This proves the test depends on the new production module.

### RED 2 - Dashboard, queue, settings, repositories, jobs/reviews
Command: `corepack yarn test tests/integration/dashboard.test.ts` (tests written before routes were registered)

```
× dashboard e fila > retorna métricas zeradas e pausa/retoma
  AssertionError: expected { statusCode: 404, ... } to deeply equal { queue: ..., reviews: ..., failures: 0 }
× dashboard e fila > valida limites das configurações do sistema
  AssertionError: expected 404 to be 400
× repositórios, jobs e reviews > lista e alterna repositórios
  AssertionError: Target cannot be null or undefined.
× repositórios, jobs e reviews > lista jobs e reviews com paginação
  AssertionError: expected { statusCode: 404, ... } to match object { total: 1, page: 1, limit: 10 }

Test Files  1 failed (1)
     Tests  4 failed (4)
```

Why expected: Fastify logged `Route GET:/api/dashboard not found`, `Route PUT:/api/settings/system not found`, `Route GET:/api/repositories not found`, and `Route GET:/api/jobs?... not found`; the new route groups were not yet registered.

### RED 3 - SSE
Command: `corepack yarn test tests/integration/events.test.ts` (test written before the SSE route existed)

```
× SSE > entrega eventos publicados no bus
  AssertionError: expected 404 to be 200 // Object.is equality
...
Test Files  1 failed (1)
     Tests  1 failed (1)
```

Why expected: `Route GET:/api/events not found` produced a 404 JSON response instead of the `text/event-stream` handshake.

### GREEN - Focused
Command: `corepack yarn test tests/unit/bus.test.ts tests/integration/events.test.ts tests/integration/dashboard.test.ts`

```
✓ tests/unit/bus.test.ts (1 test) 15ms
✓ tests/integration/events.test.ts (1 test) 1298ms
  ✓ SSE > entrega eventos publicados no bus 1293ms
✓ tests/integration/dashboard.test.ts (4 tests) 2421ms
  ✓ dashboard e fila > retorna métricas zeradas e pausa/retoma 1170ms
  ✓ dashboard e fila > valida limites das configurações do sistema 479ms
  ✓ repositórios, jobs e reviews > lista e alterna repositórios 405ms
  ✓ repositórios, jobs e reviews > lista jobs e reviews com paginação 361ms

Test Files  3 passed (3)
     Tests  6 passed (6)
```

### GREEN - Checkpoint
```
corepack yarn typecheck  -> exit 0 (no output)
corepack yarn lint       -> exit 0 (no output)
corepack yarn test       -> Test Files 20 passed (20)
                            Tests 75 passed (75)
```

## Files changed
- `src/events/bus.ts` (new, 24 lines)
- `src/api/routes/repositories.ts` (new, 27 lines)
- `src/api/routes/jobs-read.ts` (new, 45 lines)
- `src/api/routes/queue.ts` (new, 36 lines)
- `src/api/routes/settings-system.ts` (new, 32 lines)
- `src/api/routes/dashboard.ts` (new, 17 lines)
- `src/api/routes/events.ts` (new, 22 lines)
- `src/api/app.ts` (modified: `bus` in `AppDeps`, imports, six route registrations)
- `tests/helpers/app.ts` (modified: `createEventBus()` in test deps)
- `tests/unit/bus.test.ts` (new, 14 lines)
- `tests/integration/events.test.ts` (new, 27 lines)
- `tests/integration/dashboard.test.ts` (new, 110 lines, 4 tests)

## Self-review findings
- All route and bus implementations follow the brief's supplied code; no comments were added and ESM/strict-TS conventions are preserved. Typecheck and lint are clean.
- `src/api/app.ts` imports only `type { EventBus }`, not `createEventBus`: the bus is constructed by the composition root (`tests/helpers/app.ts` here), and importing `createEventBus` into `app.ts` would be unused and fail lint. The brief's wording ("importar `createEventBus`/`EventBus`") was interpreted as the needed type import.
- The brief's prose mentions publishing an initial event in `buildApp`, but the supplied code block contains only the six route registrations and no publish call. I treated the code block as authoritative and did not add an initial event; at build time there are no subscribers, so it would have no observable effect.
- I added two integration tests beyond the brief for `GET/PATCH /api/repositories` and `GET /api/jobs` / `GET /api/reviews`, because those production routes otherwise had no coverage. They assert list, toggle, 404 on unknown repository, status filtering, pagination metadata, and review listing.
- `GET /api/events` calls `reply.hijack()` and writes headers directly, so the session-renewal cookie that `requireRole` sets on the reply is not emitted on the SSE response. This matches the brief's code and does not affect authentication or the test; SSE clients still renew the session through normal HTTP requests.
- The bus is intentionally in-memory: listeners are process-local and events are not replayed or persisted. This matches the brief and the current single-process design.
- The SSE test keeps the brief's exact sequence (listen on port 0, read `: connected`, publish, read the event chunk, abort, close). It passed in the focused and full runs.
- The queue pause state is stored through the existing `app_settings` helpers, so it survives restarts and is shared with any future worker using `isQueuePaused`.
- Audit entries include `userId` and `ip` for pause/resume and system settings, consistent with existing admin routes.
- No git repository exists; no commits were made.

## Concerns
- SSE has no `Last-Event-ID` replay and the bus drops events for disconnected clients; clients must refetch dashboard/queue data after reconnecting. This is expected for the in-memory design specified by the brief.
- New read routes rely on the shared `requireRole` guard; there are no dedicated 403 tests for viewer/operator combinations on these endpoints. The guard itself is already covered by existing integration tests.
- `GET /api/reviews` ignores `status` and `repositoryId` query parameters (the brief picks only `page`/`limit`), while `GET /api/jobs` supports both filters. This asymmetry follows the brief.
- Pagination has no maximum page or total-pages metadata; `limit` is capped at 100 and `page` only requires >= 1, as specified.
- Each SSE connection holds one heartbeat interval and one bus listener; there is no per-user connection cap. Acceptable for the current deployment model, but worth bounding if many dashboards stay open.
- Repository enable/disable does not publish a bus event (the brief only publishes for queue pause/resume), so the dashboard/SSE will not reflect repository toggles until the next poll.

---

# Fix report: SSE shutdown hang and missing repository audit

## Status
DONE

## Changes
- `src/api/app.ts`: Fastify is now created with `forceCloseConnections: true`, so `app.close()` destroys open SSE sockets instead of waiting for them indefinitely.
- `src/api/routes/repositories.ts`: imported `audit` and added an audit entry after a successful toggle:
  `{ userId, action: 'repository.update', targetType: 'repository', targetId: id, data: { enabled }, ip }`.
- `tests/integration/events.test.ts`: added `fecha o app mesmo com conexão SSE aberta`. It opens a real SSE stream, reads `: connected`, deliberately does not abort, races `app.close()` against a 3s timeout, asserts `'closed'`, and performs timer clearing, abort, reader cancellation, and a final `app.close()` in `finally`. The test has a 10s timeout.
- `tests/integration/dashboard.test.ts`: the existing repository toggle test now also selects the `audit_log` row by `action = 'repository.update'` and asserts `targetId === 'repo-1'` and `dataJson` contains `"enabled":false` (imports `eq` and `auditLog`).

## TDD evidence

### RED
Command: `corepack yarn test tests/integration/events.test.ts tests/integration/dashboard.test.ts` (regression tests added before the fixes)

```
× SSE > fecha o app mesmo com conexão SSE aberta
  AssertionError: expected 'timeout' to be 'closed' // Object.is equality
× repositórios, jobs e reviews > lista e alterna repositórios
  AssertionError: expected undefined to be 'repo-1' // Object.is equality

Test Files  2 failed (2)
     Tests  2 failed | 4 passed (6)
```

Why expected: without `forceCloseConnections`, `app.close()` waited on the still-open SSE socket, so the 3s race resolved `'timeout'`; and the PATCH route did not write any audit row, so the audit lookup returned `undefined`.

### GREEN
Command: `corepack yarn test tests/integration/events.test.ts tests/integration/dashboard.test.ts`

```
✓ tests/integration/events.test.ts (2 tests) 2072ms
  ✓ SSE > entrega eventos publicados no bus 1463ms
  ✓ SSE > fecha o app mesmo com conexão SSE aberta 601ms
✓ tests/integration/dashboard.test.ts (4 tests) 2833ms
  ✓ dashboard e fila > retorna métricas zeradas e pausa/retoma 1364ms
  ✓ dashboard e fila > valida limites das configurações do sistema 614ms
  ✓ repositórios, jobs e reviews > lista e alterna repositórios 456ms
  ✓ repositórios, jobs e reviews > lista jobs e reviews com paginação 393ms

Test Files  2 passed (2)
     Tests  6 passed (6)
```

- `corepack yarn typecheck` -> clean (no output, exit 0).
- `corepack yarn lint` -> clean (no output, exit 0).
- `corepack yarn test` -> `Test Files 20 passed (20)`, `Tests 76 passed (76)` (75 previous + the new SSE shutdown test).

## Concerns
- `forceCloseConnections: true` terminates live SSE streams when the server closes; this is the intended graceful-shutdown behavior and clients must reconnect (with the existing no-replay limitation).
- The audit entry is written only after a repository row is found and the update succeeds; the 404 path remains unaudited, matching the requested placement.
- No git repository exists; no commits were made.
