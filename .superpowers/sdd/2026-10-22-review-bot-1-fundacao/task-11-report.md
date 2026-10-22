# Task 11 Report: Skills

## Status
DONE

## What I implemented
- Created `src/api/routes/skills.ts` with `registerSkillRoutes(app, deps)`:
  - `GET /api/skills` — lists all skills.
  - `POST /api/skills` — validates `name` (1-80), `description` (max 512, default `''`), `contentMd` (1-32768); rejects duplicate names with `409 skill_name_taken`; creates with UUIDv7 and timestamps; writes audit entry `skill.create`; returns `201 { skill }`.
  - `GET /api/skills/:id` — returns `{ skill }` or `404 skill_not_found`.
  - `PUT /api/skills/:id` — validates body, rejects missing skill (`404`), rejects name colliding with another skill (`409 skill_name_taken`), updates fields and `updatedAt`, writes audit `skill.update`.
  - `DELETE /api/skills/:id` — rejects missing skill (`404`), deletes (profile links cascade via FK), writes audit `skill.delete`, returns `204`.
  - All routes are guarded by `requireRole(deps, 'admin')`.
- Registered the routes in `src/api/app.ts` (`registerSkillRoutes(app, deps)` after AI profile routes).
- Created `tests/integration/skills.test.ts` with the four brief tests.

## What I tested and results
- Focused: `corepack yarn test tests/integration/skills.test.ts` → 4/4 passed.
- `corepack yarn typecheck` → clean (no output, exit 0).
- `corepack yarn lint` → clean (no output, exit 0).
- `corepack yarn test` → 15 files / 63 tests passed, including all pre-existing suites.

Note: global Yarn is 1.22.22 and rejects the project's `packageManager: yarn@4.5.1`; I ran Yarn 4.5.1 through Corepack (`corepack yarn ...`). No dependency changes were made.

## TDD evidence

### RED
Command: `corepack yarn test tests/integration/skills.test.ts` (before creating routes)

Result: 3 failed | 1 passed.

```
× skills > cria, edita, lista e remove
  → expected 404 to be 201 // Object.is equality
× skills > rejeita nome duplicado
  → expected 404 to be 409 // Object.is equality
× skills > associa skills a um perfil na ordem enviada
  → TypeError: Cannot read properties of undefined (reading 'id')
✓ skills > rejeita skill inexistente no perfil
```

Why expected: `/api/skills` was not registered, so POST returned Fastify's 404 (`Route POST:/api/skills not found`), breaking creation, duplicate-name, and profile-association flows. The fourth test only exercises the Task 10 profile validation, so it legitimately passed already.

### GREEN
Command: `corepack yarn test tests/integration/skills.test.ts` (after implementation)

```
✓ tests/integration/skills.test.ts (4 tests) 1949ms
  ✓ skills > cria, edita, lista e remove
  ✓ skills > rejeita nome duplicado
  ✓ skills > associa skills a um perfil na ordem enviada
  ✓ skills > rejeita skill inexistente no perfil

Test Files  1 passed (1)
Tests       4 passed (4)
```

Full suite: `Test Files 15 passed (15)`, `Tests 63 passed (63)`.

## Files changed
- `src/api/routes/skills.ts` (new, 72 lines)
- `src/api/app.ts` (added import and `registerSkillRoutes(app, deps)` call)
- `tests/integration/skills.test.ts` (new, 74 lines)

## Self-review findings
- Implementation matches the brief verbatim; no comments added; strict TS/ESM conventions preserved.
- Name uniqueness is enforced both at application level (explicit 409) and by the existing `skills_name_unique` DB index.
- Profile association ordering and nonexistent-skill validation are exercised through the Task 10 `ai-profiles` API and pass unchanged.
- Deleting a skill cascades to `ai_profile_skills` through the existing FK (`onDelete: 'cascade'`), so no orphaned links.
- Audit entries are written for create/update/delete with `userId`, `targetType: 'skill'`, `targetId`, and `ip`, consistent with AI profile routes.
- `tests/integration/skills.test.ts` file was written with a misplaced line in one draft; corrected before writing the final file, and the committed content matches the brief.
- No git repository exists; no commits were made.

## Concerns
- Check-then-insert for duplicate names is not atomic; under concurrent requests the DB unique index could surface as a 500 rather than 409. This mirrors the existing AI profiles pattern and is acceptable for the single-process SQLite setup; not addressed to stay within brief scope.
- Brief tests do not cover `GET /api/skills/:id` 404s, non-admin `403`, or size-limit rejection; the routes implement them and rely on the shared guard/error handler, but they have no dedicated integration assertions.
- Yarn must be invoked via Corepack in this environment (`corepack yarn`), since the global Yarn 1.22.22 refuses the project's packageManager setting.
