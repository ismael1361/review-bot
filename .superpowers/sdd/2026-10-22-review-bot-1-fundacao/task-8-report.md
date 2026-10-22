# Task 8 Report: Validação de URLs (SSRF)

## Status: DONE_WITH_CONCERNS

## What I implemented

- **`src/shared/url-guard.ts`** with exactly the brief's content:
  - `LookupFn` type: `(hostname: string) => Promise<string[]>`.
  - `isPrivateAddress(ip)`:
    - IPv4 special/private ranges: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT), `127.0.0.0/8`, `169.254.0.0/16` (link-local, incl. metadata), `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15` (benchmark), `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved/broadcast).
    - IPv6: unspecified `::`, loopback `::1`, dotted IPv4-mapped `::ffff:a.b.c.d` (delegates to IPv4 check), ULA `fc00::/7` (`fc`/`fd` prefixes) and link-local `fe80::/10` (`fe8`–`feb` prefixes).
    - Non-IP input returns `true` (fail-closed; callers only pass resolved addresses).
  - `assertSafeUrl(rawUrl, options?)`:
    - Parses with `new URL`, throwing `URL inválida` on failure.
    - Allows only `http:` and `https:`.
    - Returns immediately when `allowPrivate` is set.
    - Strips IPv6 brackets, uses `isIP` for literals, otherwise calls the injected `lookup` (default: `dns.promises.lookup` with `{ all: true, verbatim: true }`).
    - Rejects the URL if any resolved address is private, with a message containing `privado` and the offending address.
- No comments; strict TS and ESM preserved. No other files touched.

## What I tested and results

- Focused test after implementation: `corepack yarn test tests/unit/url-guard.test.ts` — **1 file, 6 tests passed**.
- `corepack yarn typecheck` — exit 0.
- `corepack yarn lint` — exit 0.
- `corepack yarn test` — **11 files, 44 tests passed** (38 pre-existing + 6 new), 9.60s.
- Note: the globally installed `yarn` is 1.22.22 while the project pins `yarn@4.5.1`; I used `corepack yarn` to run the pinned version, consistent with the previous task reports. No pnpm used; no git commands.

## TDD evidence

### RED

Command:

```
corepack yarn test tests/unit/url-guard.test.ts
```

Result:

```
FAIL tests/unit/url-guard.test.ts [ tests/unit/url-guard.test.ts ]
Error: Cannot find module '../../src/shared/url-guard' imported from
'D:/projetos/review-bot/tests/unit/url-guard.test.ts'
Caused by: Error: Failed to load url ../../src/shared/url-guard
  (resolved id: ../../src/shared/url-guard) in
  D:/projetos/review-bot/tests/unit/url-guard.test.ts. Does the file exist?

Test Files 1 failed (1)
     Tests no tests
```

Expected failure: the test file existed before the implementation, so the suite failed at import resolution with "module not found" / "Does the file exist?". This is the intended RED for a new module, not a typo or environment problem.

### GREEN

Focused:

```
corepack yarn test tests/unit/url-guard.test.ts
✓ tests/unit/url-guard.test.ts (6 tests) 22ms
Test Files 1 passed (1)
     Tests 6 passed (6)
```

Checkpoint:

```
corepack yarn typecheck   → exit 0
corepack yarn lint        → exit 0
corepack yarn test        → Test Files 11 passed (11), Tests 44 passed (44)
```

## Files changed

Created:

- `src/shared/url-guard.ts`
- `tests/unit/url-guard.test.ts`

Modified: none.

## Self-review findings

1. **Exact brief content:** implementation and test match the brief verbatim (including messages and `allowPrivate` short-circuit). No comments added.
2. **Protocol gate runs before any DNS work:** non-http(s) schemes are rejected without calling `lookup`; `allowPrivate` also returns before lookup.
3. **Literal-host normalization:** numeric/hex/octal IPv4 forms are normalized by `URL` (e.g. `http://2130706433` becomes `127.0.0.1`), then caught by the `isIP` literal path. IPv6 bracket stripping handles `[::1]` correctly.
4. **Fail-closed lookup contract:** if a custom lookup returned a non-IP string, `isPrivateAddress` returns `true` and the URL is rejected rather than accepted.
5. **Verified bypass of IPv4-mapped IPv6 in hex form (concern 1 below):** `isPrivateAddress('::ffff:7f00:1')` is `false` and `assertSafeUrl('http://[::ffff:127.0.0.1]/')` resolves successfully to `http://[::ffff:7f00:1]/`. The dotted mapped form (`::ffff:127.0.0.1`) is caught, but WHATWG URL canonicalizes literals to the hex form before the check.
6. **No side effects:** no network calls in tests; DNS is injected in every case. The default lookup is only referenced, not executed by the suite.
7. **No lint/type issues:** `noUncheckedIndexedAccess` satisfied via non-null assertions exactly as supplied; `verbatim: true` is valid in Node 22 typings.

## Concerns

1. **IPv4-mapped IPv6 bypass (security-relevant):** `http://[::ffff:127.0.0.1]/` (and `[::ffff:192.168.1.1]`, `[::ffff:169.254.169.254]`, etc.) is accepted because the URL hostname is canonicalized to `::ffff:7f00:1` / `::ffff:c0a8:101`, which the supplied `isPrivateAddress` does not recognize. Reproduction:
   ```
   corepack yarn tsx -e "import { isPrivateAddress, assertSafeUrl } from './src/shared/url-guard.ts'; void (async () => { console.log(isPrivateAddress('::ffff:7f00:1')); console.log((await assertSafeUrl('http://[::ffff:127.0.0.1]/')).href); })();"
   → false
   → http://[::ffff:7f00:1]/
   ```
   Recommended follow-up (outside the brief's exact content): expand the IPv4-mapped branch to parse hex groups (`::ffff:7f00:1`) or reject mapped/other special IPv6 forms. The supplied tests do not cover this.
2. **TOCTOU / DNS rebinding:** `assertSafeUrl` validates a resolution but the eventual HTTP client will resolve the hostname again. To close this, the fetch layer should connect to the validated IP (custom dispatcher/pinned agent) or re-check the peer address after connect, and should not follow redirects to unvalidated hosts.
3. **Empty lookup result:** if a custom `lookup` resolves to `[]`, the loop passes and the URL is accepted. Consider rejecting empty resolution sets.
4. **Not covered by this task:** redirect-based SSRF, proxy environment variables, and other IPv6 special ranges (e.g. NAT64 `64:ff9b::/96`, documentation ranges `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`). These belong to the HTTP/fetch integration layer if required.

---

# Fix Report: Critical SSRF bypass (IPv4-mapped IPv6)

## Status: FIXED

## Finding addressed

Review confirmed that `http://[::ffff:127.0.0.1]/`, `http://[::ffff:169.254.169.254]/` and `http://[::ffff:0.0.0.0]/` were accepted: WHATWG canonicalizes these literals to hex-group form (`::ffff:7f00:1`, `::ffff:a9fe:a9fe`, `::ffff:0:0`), which the previous regex (dotted-decimal only) did not match. The full form `0:0:0:0:0:0:0:1` was also missed.

## Changes

- **`src/shared/url-guard.ts`**:
  - Added `parseIpv6(ip)` exactly as required: strips an optional `%zone`, splits on `::`, parses hex groups and dotted-decimal tail groups into eight 16-bit groups, returns `null` for malformed input (fail-closed as private).
  - Replaced the IPv6 branch of `isPrivateAddress` with group-based classification:
    - unspecified/loopback and IPv4-compatible (`groups[0..5] === 0`), including `::`, `::1`, and the full form `0:0:0:0:0:0:0:1`;
    - IPv4-mapped `::ffff:0:0/96` (any canonical/hex/dotted/full form), delegating the embedded IPv4 to the IPv4 range checks;
    - NAT64 `64:ff9b::/96` (conservatively treated as private);
    - ULA `fc00::/7`, link-local `fe80::/10`, deprecated site-local `fec0::/10`, multicast `ff00::/8`;
    - 6to4 `2002::/16` and Teredo `2001:0::/32` (conservative).
  - `assertSafeUrl` now throws `Endereço não resolvido` when the resolver returns an empty array, so an empty lookup cannot bypass validation.
- **`tests/unit/url-guard.test.ts`**: added regression coverage:
  - private: `::ffff:7f00:1`, `::ffff:a9fe:a9fe`, `::ffff:0:0`, `0:0:0:0:0:0:0:1`, `64:ff9b::7f00:1`, `fec0::1`, `ff02::1`, `2002:7f00:1::`;
  - public: `::ffff:8.8.8.8`, `2606:4700:4700::1111`;
  - `assertSafeUrl` rejects `http://[::ffff:127.0.0.1]/` and `http://[::ffff:169.254.169.254]/` with `/privado/`;
  - `assertSafeUrl` rejects an empty lookup result with `/não resolvido/`;
  - `assertSafeUrl` rejects a mixed resolution `['8.8.8.8', '10.0.0.5']`;
  - `assertSafeUrl` accepts literal public IPv6 `https://[2606:4700:4700::1111]/` without invoking the injected lookup (the lookup throws if called).

## Covering test commands and output

Focused:

```
corepack yarn test tests/unit/url-guard.test.ts
✓ tests/unit/url-guard.test.ts (11 tests) 37ms
Test Files 1 passed (1)
     Tests 11 passed (11)
```

Checkpoint:

```
corepack yarn typecheck   → exit 0
corepack yarn lint        → exit 0
corepack yarn test        → Test Files 11 passed (11), Tests 49 passed (49)
```

Exploit repro after the fix (same commands that previously returned `false` / accepted):

```
corepack yarn tsx -e "import { isPrivateAddress, assertSafeUrl } from './src/shared/url-guard.ts'; void (async () => { ... })();"
::ffff:7f00:1 true
::ffff:a9fe:a9fe true
::ffff:0:0 true
0:0:0:0:0:0:0:1 true
::ffff:8.8.8.8 false
2606:4700:4700::1111 false
rejected http://[::ffff:127.0.0.1]/ - Endereço privado não permitido: ::ffff:7f00:1
rejected http://[::ffff:169.254.169.254]/ - Endereço privado não permitido: ::ffff:a9fe:a9fe
rejected http://[::ffff:0.0.0.0]/ - Endereço privado não permitido: ::ffff:0:0
```

## Files changed in the fix

Modified:

- `src/shared/url-guard.ts`
- `tests/unit/url-guard.test.ts`

## Self-review findings

1. The parser validates group count and value shape, and `isPrivateAddress` treats any parse failure as private (fail-closed).
2. All equivalent encodings of the same mapped address resolve to the same eight groups: dotted (`::ffff:127.0.0.1`), canonical hex (`::ffff:7f00:1`), and full (`0:0:0:0:0:ffff:127.0.0.1`).
3. Public mapped IPv6 (`::ffff:8.8.8.8`) remains allowed; the embedded IPv4 is what is classified, not the `::ffff` prefix itself.
4. IPv6 literal handling does not call the resolver; the test with a throwing lookup proves it.
5. Empty resolver output is now rejected; a mix containing any private address is also rejected (existing loop already short-circuits on the first private entry).
6. No comments added; strict TS and ESM preserved; typecheck, lint and the full suite are green.

## Concerns (remaining)

1. **TOCTOU / DNS rebinding (not fixed here):** `assertSafeUrl` validates one resolution, but a later fetch may resolve again. The HTTP layer must pin the validated address (custom dispatcher/agent) or re-check the connected peer, and must not follow redirects to unvalidated hosts.
2. **Conservative IPv6 classes:** all of `64:ff9b::/96`, `2002::/16` (6to4) and `2001:0::/32` (Teredo) are treated as private, including addresses embedding public IPv4. This is intentional fail-closed behavior but may block legitimate NAT64/6to4 endpoints.
3. Other IPv6 documentation ranges and unusual transition mechanisms are not specially classified; they are not local/private targets and remain outside this task.

