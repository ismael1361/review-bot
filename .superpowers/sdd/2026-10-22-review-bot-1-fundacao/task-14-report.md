# Task 14 Report: SPA React do painel

## Status
DONE

## What I implemented

### Build and entry points
- `vite.config.ts`: Vite root `src/web`, React + Tailwind v4 plugins, build to `dist/web`, dev server on 5173 with `/api` and `/healthz` proxied to `http://localhost:3000`.
- `src/web/index.html`: Vite entry with `#root`, `pt-BR`, dark theme color meta.
- `src/web/index.css`: Tailwind import, `color-scheme: dark`, body `#020617` with `#e2e8f0` text.
- `src/web/main.tsx`: React 19 `createRoot`, `QueryClientProvider` (retry 1, no refetch on focus), `BrowserRouter`, `StrictMode`.

### API client and UI primitives
- `src/web/api.ts`: `api<T>(path, options)` with same-origin credentials, JSON content type, 204 handling, JSON error extraction, and `ApiRequestError` (`message`, `code`, `status`).
- `src/web/components/ui.tsx`: dark `Card`, `Field`, `Input`, `Button`, `ErrorText` and `EmptyState`. `Input`/`Button` merge an optional caller `className`; primary button uses `bg-slate-200 text-slate-900 hover:bg-white`.

### Routing, auth gate and layout
- `src/web/components/ProtectedRoute.tsx`: `Me` type, `useMe()` query on `/api/auth/me`, loading state, redirect to `/login` on error/no user, `Outlet` with `{ user }` context.
- `src/web/components/Layout.tsx`: dark header with `review-bot` brand, Dashboard/Reviews/Fila/Definições navigation, active link highlighting, `username · role`, and logout (`POST /api/auth/logout`, clear query cache, navigate to login).
- `src/web/app.tsx`: `/setup`, `/login`, `SetupGate` (`/api/setup/status` redirect to `/setup`), protected `Layout` routes for dashboard, reviews, queue and `/settings/*`.

### Pages
- `Setup.tsx`: token/root username/password/confirmation form, minimum 12-character check, password-match check, API error display, redirect to `/` on success. Dark card centered on `bg-slate-950`.
- `Login.tsx`: username/password, API error display (e.g. `Credenciais inválidas`), query invalidation and redirect on success. Dark card.
- `Dashboard.tsx`: four metric cards (queue, running, reviews 24h, failures), loading placeholders (`—`) and query error message.
- `Reviews.tsx`: reviews table with status/comments/link, empty state, query error message, dark table styling.
- `Queue.tsx`: queue counts, paused indicator, pause/resume mutation, jobs list with PR links, empty state, query error message.
- `pages/settings/index.tsx`: settings heading, six tabs (GitHub, IA, Skills, Usuários, Webhooks, Sistema) with active underline, nested routes, `/settings` redirects to `/settings/github`.
- `pages/settings/Github.tsx`: current credential display, PAT form, save-and-test mutation, success/error messages.
- `pages/settings/Profiles.tsx`: profile list with active badge, test/activate actions, new-profile form (provider select, base URL, model, API key).
- `pages/settings/Skills.tsx`: skill list with remove action, new-skill form with Markdown textarea.
- `pages/settings/Users.tsx`: user list, root protection, enable/disable action, new-user form with role select.
- `pages/settings/Webhooks.tsx`: webhook list with test action, one-time secret display, URL + event checkbox form.
- `pages/settings/System.tsx`: polling interval, retention, concurrency, draft/own-PR checkboxes, save mutation, loading and error states.

### Fastify static serving
- `src/api/app.ts`: after all API routes, if `dist/web` exists, registers `@fastify/static` with `wildcard: false`; `setNotFoundHandler` returns JSON `not_found` for `/api/*` and otherwise serves `index.html` for SPA routes.

### Tests
- `tests/web/setup.test.tsx` (brief tests): password mismatch shows `As senhas não coincidem.`; valid data POSTs to `/api/setup`.
- `tests/web/login.test.tsx` (brief test): invalid credentials shows the API message.
- `vitest.config.ts`: enabled `globals: true` so `@testing-library/react` registers its automatic cleanup. Without it, the second Setup test saw two rendered forms and failed with `Found multiple elements with the text of: Token de setup`. The brief tests themselves were not modified.

## What I tested and results

### Focused web tests
Command: `corepack yarn test tests/web/setup.test.tsx tests/web/login.test.tsx`

```
✓ tests/web/login.test.tsx (1 test)
✓ tests/web/setup.test.tsx (2 tests)

Test Files  2 passed (2)
     Tests  3 passed (3)
```

### Build
Command: `corepack yarn build:web`

```
vite v6.4.5 building for production...
✓ 102 modules transformed.
../../dist/web/index.html                 0.45 kB
../../dist/web/assets/index-*.css        14.98 kB
../../dist/web/assets/index-*.js        329.87 kB (101.17 kB gzip)
✓ built in 3.12s
```

`dist/web/index.html` exists.

### Full checkpoint
- `corepack yarn typecheck` -> clean (no output, exit 0).
- `corepack yarn lint` -> clean (no output, exit 0).
- `corepack yarn test` -> `Test Files 22 passed (22)`, `Tests 79 passed (79)`.
- `corepack yarn build:web` -> success after the final edits.

### Static serving verification
Temporary script using the test app helper with `dist/web` present:
- `GET /reviews` -> `200 text/html; charset=utf-8`, body starts with `<!doctype html>` (SPA fallback).
- `GET /api/does-not-exist` -> `404` with `{"error":{"code":"not_found","message":"Rota não encontrada"}}`.

### Visual verification
Built SPA served through Vite preview and a temporary local mock API; captured headless Chrome screenshots at 1440x900/1000 for:
- `/setup`, `/login`
- `/`, `/reviews`, `/queue`
- `/settings` (redirects to GitHub), `/settings/github`, `/settings/ia`, `/settings/skills`, `/settings/usuarios`, `/settings/webhooks`, `/settings/sistema`

Confirmed: dark page (`#020617`), dark header/cards (`slate-900`), `slate-800` borders, dark inputs, light primary buttons, visible sky focus ring, no white cards, and active settings tab underline. Screenshots were temporary artifacts outside the project.

Note: global Yarn is 1.22.22 and rejects the project's `packageManager: yarn@4.5.1`; Yarn 4.5.1 was run through Corepack (`corepack yarn ...`), consistent with previous task reports. No dependency changes were made.

## TDD evidence

### RED - components do not exist
Tests were written before the pages. Command:

`corepack yarn test tests/web/setup.test.tsx tests/web/login.test.tsx`

```
FAIL tests/web/login.test.tsx [ tests/web/login.test.tsx ]
Error: Failed to resolve import "../../src/web/pages/Login" from "tests/web/login.test.tsx". Does the file exist?

FAIL tests/web/setup.test.tsx [ tests/web/setup.test.tsx ]
Error: Failed to resolve import "../../src/web/pages/Setup" from "tests/web/setup.test.tsx". Does the file exist?

Test Files  2 failed (2)
     Tests  no tests
```

Why expected: `src/web/pages/Setup.tsx` and `Login.tsx` did not exist yet, so the suites could not load. This proves both tests depend on the new production components.

### GREEN - first implementation
After creating the pages, the focused run produced:

```
✓ tests/web/login.test.tsx (1 test)
❯ tests/web/setup.test.tsx (2 tests | 1 failed)
  × envia o setup quando os dados são válidos
    TestingLibraryElementError: Found multiple elements with the text of: Token de setup
```

Cause: Testing Library auto-cleanup was not registered because Vitest globals were disabled, so the first test's form remained mounted. Fixed by enabling `globals: true` in `vitest.config.ts`; no test assertions were changed.

### GREEN - final
Command: `corepack yarn test tests/web/setup.test.tsx tests/web/login.test.tsx`

```
✓ tests/web/login.test.tsx (1 test)
  ✓ Login > mostra mensagem para credenciais inválidas
✓ tests/web/setup.test.tsx (2 tests)
  ✓ Setup > mostra erro quando as senhas não coincidem
  ✓ Setup > envia o setup quando os dados são válidos

Test Files  2 passed (2)
     Tests  3 passed (3)
```

## Files changed

Created:
- `vite.config.ts`
- `src/web/index.html`
- `src/web/index.css`
- `src/web/main.tsx`
- `src/web/api.ts`
- `src/web/app.tsx`
- `src/web/components/Layout.tsx`
- `src/web/components/ProtectedRoute.tsx`
- `src/web/components/ui.tsx`
- `src/web/pages/Setup.tsx`
- `src/web/pages/Login.tsx`
- `src/web/pages/Dashboard.tsx`
- `src/web/pages/Reviews.tsx`
- `src/web/pages/Queue.tsx`
- `src/web/pages/settings/index.tsx`
- `src/web/pages/settings/Github.tsx`
- `src/web/pages/settings/Profiles.tsx`
- `src/web/pages/settings/Skills.tsx`
- `src/web/pages/settings/Users.tsx`
- `src/web/pages/settings/Webhooks.tsx`
- `src/web/pages/settings/System.tsx`
- `tests/web/setup.test.tsx`
- `tests/web/login.test.tsx`

Modified:
- `src/api/app.ts` (imports `existsSync`, `join`, `@fastify/static`; registers static serving and SPA/API fallback)
- `vitest.config.ts` (`globals: true` for Testing Library auto-cleanup)

Generated (not source):
- `dist/web/index.html`
- `dist/web/assets/index-*.css`
- `dist/web/assets/index-*.js`

## Self-review findings
- Dark theme is applied consistently: page `bg-slate-950`/`#020617`, header and cards `bg-slate-900`, borders `border-slate-800`, inputs `bg-slate-800` with `border-slate-700`, primary text `text-slate-100`, secondary `text-slate-400`, muted `text-slate-500`, primary buttons `bg-slate-200 text-slate-900`, focus `ring-sky-400`. The only `bg-white` is the approved `hover:bg-white` on the primary button.
- Setup and Login are dark and visually match the mockups (brand label, centered card, full-width primary action).
- Visual review found and fixed two real bugs:
  1. `Input`/`Button` overwrote a caller-provided `className`, so the auth submit buttons were not full width despite `w-full`. Both helpers now merge `className`.
  2. Settings tab `NavLink`s used relative `to` values and resolved to `/settings/ia/ia` (and similar), so no tab was ever active. Tabs now use absolute `/settings/<tab>` paths; `/settings` redirects to `/settings/github`.
- Loading/error states: `ProtectedRoute`/`SetupGate` show `Carregando…`; Setup/Login show inline API errors; Dashboard, Reviews and Queue show query errors; every settings tab now shows a query error when its GET fails; System has loading and error states.
- No placeholders, TODOs or code comments were added. Strict TypeScript and ESM are preserved; typecheck and lint are clean.
- Static fallback was verified with the real Fastify app: SPA routes return `index.html`, `/api/*` unknown routes keep the JSON `not_found` contract.
- `dist/web` is checked at `buildApp` time. In the Docker flow `build:web` runs before the server starts, so the SPA is served on boot; starting the server before building would require a restart after the build.
- No root `index.html` existed to move; only `src/web/index.html` was created, as required by the Vite root.
- No git repository exists; no commits were made.

## Concerns
- `src/web/api.ts` follows the brief exactly. Because `...options` is spread after `headers`, a caller that passes its own `headers` would replace the default `content-type` instead of merging. Current callers do not pass headers; future callers should merge explicitly.
- Settings list queries show empty lists while loading (no skeleton/spinner); only errors are displayed. This follows the brief's structure and does not affect correctness.
- `/setup` remains reachable after setup is complete and `/login` remains reachable while authenticated; both are brief behavior. The API rejects an invalid setup token and the protected routes redirect appropriately.
- The SPA fallback serves `index.html` for any unknown non-API path, including missing asset paths. This is standard SPA behavior but can surface as an HTML/MIME error for a stale asset reference.
- `vitest.config.ts` now enables globals project-wide. Existing tests import their helpers explicitly, so there is no behavior change; it exists solely to make Testing Library cleanup work with the brief's tests.
- The production JS bundle is ~330 kB (~101 kB gzip); acceptable for this panel, but it can be split later if more pages are added.

---

# Fix report: api headers, setup gate and webhook test result

## Status
DONE

## Changes
- `src/web/api.ts`: only adds `content-type: application/json` when `options.body` is neither `undefined` nor `null`; builds a single `headers` object with the caller headers last, and spreads `...options` before `headers` so caller-provided headers are preserved.
- `src/web/app.tsx`: `SetupGate` now treats `status.isFetching` as loading (`if (status.isLoading || status.isFetching)`), so a cached `needsSetup: true` no longer redirects back to `/setup` while the post-setup refetch is in flight.
- `src/web/pages/settings/Webhooks.tsx`: added `testMessage`/`testOk` state. The test mutation sets `Entrega disparada.` only when `data.ok` is true, `Falha na entrega.` when false, and `Falha ao testar.` on request error. The message renders green on success and red on failure.
- `tests/web/api.test.ts` (new, 3 tests): bodyless POST has no `content-type`; a JSON body sends `content-type: application/json`; a caller-provided header is preserved alongside the default.
- `tests/web/webhooks.test.tsx` (new, 1 test): GET returns one webhook and POST `/api/webhooks/w1/test` returns `{ ok: false }`; clicking `Testar` shows `Falha na entrega.` and not `Entrega disparada.`.
- `tests/web/app.test.tsx` (new, 1 test): renders the full app at `/`, completes the setup form, and asserts the Dashboard appears instead of bouncing back to `/setup`. The post-setup status response is delayed 100 ms so the cached `needsSetup: true` is actually observed while the refetch is pending.

## Covering test commands and output

### RED
Command: `corepack yarn test tests/web` (regression tests added before the fixes)

```
× api > não envia content-type em requisição sem body
  AssertionError: expected 'application/json' to be undefined
× api > preserva headers enviados pelo chamador
  AssertionError: expected undefined to be 'application/json'
× Webhooks > mostra falha quando o teste de entrega retorna ok false
  TestingLibraryElementError: Unable to find an element with the text: Falha na entrega.
  DOM showed "Entrega disparada."
× App setup gate > não volta para /setup depois que o setup termina
  TestingLibraryElementError: Unable to find role="heading" and name "Dashboard"
  DOM showed the Setup form again

Test Files  2 failed | 3 passed (5)
     Tests  3 failed | 5 passed (8)
```

The app-gate test initially passed because the mocked refetch resolved before React rendered the cached state; the mock was changed to delay the post-setup `/api/setup/status` response by 100 ms, after which it failed as expected. This is a test-harness timing change, not a production change.

### GREEN
Command: `corepack yarn test tests/web`

```
✓ tests/web/api.test.ts (3 tests)
✓ tests/web/webhooks.test.tsx (1 test)
✓ tests/web/login.test.tsx (1 test)
✓ tests/web/setup.test.tsx (2 tests)
✓ tests/web/app.test.tsx (1 test)

Test Files  5 passed (5)
     Tests  8 passed (8)
```

### Full checkpoint
- `corepack yarn typecheck` -> clean (no output, exit 0).
- `corepack yarn lint` -> clean (no output, exit 0).
- `corepack yarn test` -> `Test Files 25 passed (25)`, `Tests 84 passed (84)`.
- `corepack yarn build:web` -> 102 modules transformed; `dist/web/index.html` 0.45 kB, CSS 14.98 kB, JS 330.07 kB (101.26 kB gzip).

## Concerns
- `api` still sets `content-type: application/json` for any non-null body. If a caller later sends `FormData`, `Blob` or `URLSearchParams`, the header should be omitted; current callers always send JSON strings.
- `SetupGate` shows the loading state during every background refetch of `/api/setup/status`, not only after setup. This is the requested behavior and prevents the bounce, but it can flash the loading text on navigation.
- `testMessage` is global to the Webhooks card, not per row; testing another webhook replaces the previous message. This matches the single-message pattern requested.
- No git repository exists; no commits were made.
