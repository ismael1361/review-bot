# Task 4 Report: Criptografia de segredos e senhas

## What I implemented

- `src/auth/crypto.ts`: AES-256-GCM secret encryption with a versioned `v1:<iv>:<tag>:<ciphertext>` payload format, 12-byte random IVs, base64 encryption key loading with a 32-byte length check, SHA-256 token hashing, and constant-time hex comparison via `crypto.timingSafeEqual`.
- `src/auth/password.ts`: password hashing and verification through `@node-rs/argon2`, configured with `memoryCost: 65536`, `timeCost: 3` and `parallelism: 1`. `verifyPassword` returns `false` for malformed hashes or verification errors.
- `tests/unit/crypto.test.ts`: the five brief tests covering encrypt/decrypt round-trip, unique IVs, key-length rejection, tamper detection and constant-time hash comparison.
- `tests/unit/password.test.ts`: the two brief tests covering successful/failed verification and invalid hash handling.

Implementation and test content match the brief verbatim. No comments were added. No new dependency was needed because `@node-rs/argon2` was already in `package.json`.

## What I tested and results

- `corepack yarn test tests/unit/crypto.test.ts tests/unit/password.test.ts` (RED): 2 failed suites, no tests collected, both failing on missing `src/auth/*` modules.
- `corepack yarn test tests/unit/crypto.test.ts tests/unit/password.test.ts` (GREEN): 2 files / 7 tests passed (crypto 5, password 2).
- `corepack yarn typecheck`: passed (exit 0, no output).
- `corepack yarn lint`: passed (exit 0, no output).
- `corepack yarn test`: 6 files / 15 tests passed (crypto 5, password 2, config 4, logger 1, db 2, health 1).

Yarn was run through Corepack because the globally installed `yarn` is 1.22.22, while the project pins Yarn 4.5.1 via `packageManager`.

## TDD evidence

### RED

Command: `corepack yarn test tests/unit/crypto.test.ts tests/unit/password.test.ts`

Output (excerpt):

```
 FAIL  tests/unit/crypto.test.ts [ tests/unit/crypto.test.ts ]
Error: Cannot find module '../../src/auth/crypto' imported from 'D:/projetos/review-bot/tests/unit/crypto.test.ts'
Caused by: Error: Failed to load url ../../src/auth/crypto ... Does the file exist?

 FAIL  tests/unit/password.test.ts [ tests/unit/password.test.ts ]
Error: Cannot find module '../../src/auth/password' imported from 'D:/projetos/review-bot/tests/unit/password.test.ts'
Caused by: Error: Failed to load url ../../src/auth/password ... Does the file exist?

 Test Files  2 failed (2)
      Tests  no tests
```

Why expected: both test files were written before either implementation module existed. The failures come from the missing crypto/password modules that the task is meant to add, not from mistakes in the test assertions. This is the expected first TDD failure.

### GREEN

Command: `corepack yarn test tests/unit/crypto.test.ts tests/unit/password.test.ts`

Output:

```
 ✓ tests/unit/crypto.test.ts (5 tests) 16ms
 ✓ tests/unit/password.test.ts (2 tests) 376ms
   ✓ password > gera hash verificável 372ms

 Test Files  2 passed (2)
      Tests  7 passed (7)
```

Full checkpoint after implementation:

```
corepack yarn test
 ✓ tests/unit/crypto.test.ts (5 tests)
 ✓ tests/unit/config.test.ts (4 tests)
 ✓ tests/unit/logger.test.ts (1 test)
 ✓ tests/unit/password.test.ts (2 tests)
 ✓ tests/integration/health.test.ts (1 test)
 ✓ tests/unit/db.test.ts (2 tests)

 Test Files  6 passed (6)
      Tests  15 passed (15)
```

`corepack yarn typecheck` and `corepack yarn lint` both exited 0 with no output.

## Files changed

- Created `src/auth/crypto.ts`
- Created `src/auth/password.ts`
- Created `tests/unit/crypto.test.ts`
- Created `tests/unit/password.test.ts`

No other files were modified. The project has no git repository, so no commit was created and no repository was initialized.

## Self-review findings

- `src/auth/crypto.ts` implements all produced interfaces required by the brief: `loadEncryptionKey`, `encryptSecret`, `decryptSecret`, `hashToken` and `constantTimeEqualHex`.
- AES-256-GCM uses a fresh `randomBytes(12)` IV for every encryption, and the test confirms repeated encryption of the same plaintext yields different payloads.
- GCM authentication is enforced by `decipher.final()`, which is why modifying the payload causes decryption to throw.
- Payload parsing rejects a wrong version and any missing IV, tag or ciphertext segment.
- `constantTimeEqualHex` rejects unequal decoded lengths and empty inputs before calling `timingSafeEqual`, avoiding the exception that `timingSafeEqual` throws on length mismatch.
- `hashToken` uses SHA-256 and returns lowercase hex, matching the expected comparison interface.
- `hashPassword` returns the Argon2 PHC-format string; `@node-rs/argon2` defaults to Argon2id, confirmed in its package documentation. The configured memory/time/parallelism values match the brief.
- `verifyPassword` wraps verification in `try/catch`, so a malformed string such as `nao-e-hash` returns `false` instead of rejecting.
- No comments are present in the new files, the code is strict-TypeScript clean, and lint passes.
- All pre-existing tests still pass.

## Concerns

- `loadEncryptionKey` validates only the decoded byte length. Node's permissive base64 decoder can silently ignore invalid characters, so a malformed string that still decodes to exactly 32 bytes would be accepted. This matches the brief's implementation exactly.
- `constantTimeEqualHex` assumes hex input. Non-hex strings can be truncated by `Buffer.from(..., 'hex')`; callers should pass outputs of `hashToken`. Invalid or odd-length input may therefore compare as false or on a truncated byte prefix.
- `verifyPassword` catches every error, including unexpected Argon2 backend/runtime failures, and reports them as an invalid password. This is the brief's intended behavior but can hide infrastructure errors.
- The tests verify password behavior end-to-end but do not parse the PHC string to assert Argon2id/parameter values, and do not separately test wrong-version or truncated encrypted payloads.
