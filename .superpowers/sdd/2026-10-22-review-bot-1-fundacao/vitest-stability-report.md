# Vitest Stability Report

Date: 2026-10-22
Project: D:\projetos\review-bot
Status: PASS

## Change

`vitest.config.ts` now sets:

```ts
testTimeout: 20_000,
hookTimeout: 20_000,
fileParallelism: false,
```

Existing `environment`, `globals`, `include` and `setupFiles` entries were preserved. No test or application code was changed.

## Verification

All commands run from `D:\projetos\review-bot` with `corepack yarn`.

### Run 1 — `corepack yarn test`

```
 Test Files  25 passed (25)
      Tests  84 passed (84)
   Duration  132.04s (transform 21.28s, setup 272ms, collect 46.46s, tests 46.30s, environment 11.46s, prepare 9.01s)
```

### Run 2 — `corepack yarn test`

```
 Test Files  25 passed (25)
      Tests  84 passed (84)
   Duration  64.97s (transform 1.12s, setup 131ms, collect 14.35s, tests 32.47s, environment 6.77s, prepare 4.77s)
```

No timeouts or failures in either run.

### `corepack yarn typecheck`

Exit code 0, no diagnostics.

### `corepack yarn lint`

Exit code 0, no findings.

## Remaining concerns

- `fileParallelism: false` removes cross-file parallelism, so full-suite wall time is now roughly the sum of file runtimes (65–132s here). The first run was slower due to cold transform/collect caches.
- The 20s timeouts are a mitigation for contention, not a performance fix. On slower CI runners with default Argon2id parameters (64MB per hash), individual setup hooks could still approach the limit.
- Argon2id tests dominate runtime; lowering test-only Argon2 parameters would reduce duration but was out of scope and would change test code.
