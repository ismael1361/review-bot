### Task 3: Banco, schema completo, migrations e settings

**Files:**
- Create: `drizzle.config.ts`, `src/db/schema.ts`, `src/db/client.ts`, `src/db/migrate.ts`, `src/db/settings.ts`
- Create: `tests/helpers/db.ts`
- Test: `tests/unit/db.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `createDb(path: string): { sqlite, db }`; `Db`; `runMigrations(db, folder)`; `getSetting<T>(db, key): T | undefined`; `setSetting(db, key, value)`; `deleteSetting(db, key)`; `createTestDb(): Db`; todas as tabelas do spec exportadas de `src/db/schema.ts`.

- [ ] **Step 1: Criar `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
```

- [ ] **Step 2: Implementar `src/db/schema.ts` com todas as tabelas**

```ts
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'operator', 'viewer'] }).notNull(),
  isRoot: integer('is_root', { mode: 'boolean' }).notNull().default(false),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  lastLoginAt: integer('last_login_at'),
}, (t) => [uniqueIndex('users_username_unique').on(t.username)]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  lastSeenAt: integer('last_seen_at').notNull(),
  idleExpiresAt: integer('idle_expires_at').notNull(),
  absoluteExpiresAt: integer('absolute_expires_at').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
}, (t) => [uniqueIndex('sessions_token_unique').on(t.tokenHash), index('sessions_user').on(t.userId)]);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const githubCredentials = sqliteTable('github_credentials', {
  id: text('id').primaryKey(),
  login: text('login').notNull(),
  patEncrypted: text('pat_encrypted').notNull(),
  patLast4: text('pat_last4').notNull(),
  scopes: text('scopes'),
  validatedAt: integer('validated_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const aiProfiles = sqliteTable('ai_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider', { enum: ['openai_compatible', 'anthropic'] }).notNull(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  apiKeyEncrypted: text('api_key_encrypted').notNull(),
  temperature: real('temperature').notNull(),
  maxOutputTokens: integer('max_output_tokens').notNull(),
  maxTurns: integer('max_turns').notNull(),
  maxTotalTokens: integer('max_total_tokens').notNull(),
  maxDurationSec: integer('max_duration_sec').notNull(),
  maxFindings: integer('max_findings').notNull(),
  maxGithubCalls: integer('max_github_calls').notNull(),
  prePrompt: text('pre_prompt').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [uniqueIndex('ai_profiles_name_unique').on(t.name)]);

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  contentMd: text('content_md').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [uniqueIndex('skills_name_unique').on(t.name)]);

export const aiProfileSkills = sqliteTable('ai_profile_skills', {
  profileId: text('profile_id').notNull().references(() => aiProfiles.id, { onDelete: 'cascade' }),
  skillId: text('skill_id').notNull().references(() => skills.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
}, (t) => [primaryKey({ columns: [t.profileId, t.skillId] })]);

export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  githubId: text('github_id').notNull(),
  owner: text('owner').notNull(),
  name: text('name').notNull(),
  fullName: text('full_name').notNull(),
  private: integer('private', { mode: 'boolean' }).notNull().default(false),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  discoveredAt: integer('discovered_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (t) => [uniqueIndex('repositories_github_id_unique').on(t.githubId), uniqueIndex('repositories_full_name_unique').on(t.fullName)]);

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').notNull().references(() => repositories.id),
  prNumber: integer('pr_number').notNull(),
  prTitle: text('pr_title').notNull(),
  prUrl: text('pr_url').notNull(),
  authorLogin: text('author_login').notNull(),
  headSha: text('head_sha').notNull(),
  baseSha: text('base_sha').notNull(),
  runSeq: integer('run_seq').notNull().default(1),
  status: text('status', { enum: ['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled'] }).notNull(),
  priority: integer('priority').notNull().default(0),
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  profileId: text('profile_id').references(() => aiProfiles.id),
  profileSnapshotJson: text('profile_snapshot_json'),
  queuedAt: integer('queued_at').notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  heartbeatAt: integer('heartbeat_at'),
  lockedBy: text('locked_by'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  usageJson: text('usage_json'),
}, (t) => [
  uniqueIndex('jobs_unique_run').on(t.repositoryId, t.prNumber, t.headSha, t.runSeq),
  index('jobs_status_queued').on(t.status, t.queuedAt),
]);

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  githubReviewId: text('github_review_id'),
  url: text('url'),
  body: text('body').notNull(),
  event: text('event').notNull(),
  commentsPosted: integer('comments_posted').notNull().default(0),
  commentsFallback: integer('comments_fallback').notNull().default(0),
  status: text('status', { enum: ['posted', 'fallback', 'failed'] }).notNull(),
  postedAt: integer('posted_at'),
}, (t) => [uniqueIndex('reviews_job_unique').on(t.jobId)]);

export const reviewFindings = sqliteTable('review_findings', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  reviewId: text('review_id').references(() => reviews.id, { onDelete: 'set null' }),
  path: text('path').notNull(),
  startLine: integer('start_line'),
  endLine: integer('end_line'),
  side: text('side').notNull().default('RIGHT'),
  severity: text('severity', { enum: ['critical', 'medium', 'suggestion', 'strength'] }).notNull(),
  title: text('title').notNull(),
  bodyMd: text('body_md').notNull(),
  suggestionMd: text('suggestion_md'),
  status: text('status', { enum: ['valid', 'outside_diff', 'duplicate', 'posted', 'fallback', 'rejected'] }).notNull(),
  githubCommentId: text('github_comment_id'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('findings_job_status').on(t.jobId, t.status)]);

export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  seq: integer('seq').notNull(),
  role: text('role').notNull(),
  contentJson: text('content_json').notNull(),
  toolName: text('tool_name'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('agent_messages_job_seq').on(t.jobId, t.seq)]);

export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  jobId: text('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  level: text('level', { enum: ['info', 'warn', 'error'] }).notNull(),
  type: text('type').notNull(),
  message: text('message').notNull(),
  dataJson: text('data_json'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('events_job_created').on(t.jobId, t.createdAt)]);

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  secretEncrypted: text('secret_encrypted').notNull(),
  eventsJson: text('events_json').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull().references(() => webhooks.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  success: integer('success', { mode: 'boolean' }).notNull(),
  statusCode: integer('status_code'),
  attempt: integer('attempt').notNull(),
  responseExcerpt: text('response_excerpt'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('webhook_deliveries_webhook_created').on(t.webhookId, t.createdAt)]);

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  dataJson: text('data_json'),
  ip: text('ip'),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('audit_log_created').on(t.createdAt)]);

export const githubCache = sqliteTable('github_cache', {
  key: text('key').primaryKey(),
  etag: text('etag').notNull(),
  payloadJson: text('payload_json').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
```

- [ ] **Step 3: Implementar `src/db/client.ts`, `src/db/migrate.ts` e `src/db/settings.ts`**

`src/db/client.ts`:

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

export function createDb(path: string): { sqlite: Database.Database; db: Db } {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  if (path !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}
```

`src/db/migrate.ts`:

```ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client';

export function runMigrations(db: Db, folder: string): void {
  migrate(db, { migrationsFolder: folder });
}
```

`src/db/settings.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { appSettings } from './schema';

export function getSetting<T>(db: Db, key: string): T | undefined {
  const row = db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  if (!row) {
    return undefined;
  }
  return JSON.parse(row.valueJson) as T;
}

export function setSetting(db: Db, key: string, value: unknown): void {
  const now = Date.now();
  const valueJson = JSON.stringify(value);
  db.insert(appSettings)
    .values({ key, valueJson, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { valueJson, updatedAt: now } })
    .run();
}

export function deleteSetting(db: Db, key: string): void {
  db.delete(appSettings).where(eq(appSettings.key, key)).run();
}
```

- [ ] **Step 4: Gerar as migrations**

Run: `yarn db:generate`
Expected: cria `drizzle/0000_*.sql` e `drizzle/meta/_journal.json` sem erros.

- [ ] **Step 5: Criar `tests/helpers/db.ts` e o teste que falha**

`tests/helpers/db.ts`:

```ts
import { createDb, type Db } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';

export function createTestDb(): Db {
  const { db } = createDb(':memory:');
  runMigrations(db, 'drizzle');
  return db;
}
```

`tests/unit/db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTestDb } from '../helpers/db';
import { getSetting, setSetting, deleteSetting } from '../../src/db/settings';
import { users } from '../../src/db/schema';

describe('banco', () => {
  it('grava e lê settings', () => {
    const db = createTestDb();
    expect(getSetting<string>(db, 'x')).toBeUndefined();
    setSetting(db, 'x', { a: 1 });
    expect(getSetting<{ a: number }>(db, 'x')).toEqual({ a: 1 });
    setSetting(db, 'x', 2);
    expect(getSetting<number>(db, 'x')).toBe(2);
    deleteSetting(db, 'x');
    expect(getSetting(db, 'x')).toBeUndefined();
  });

  it('rejeita username duplicado', () => {
    const db = createTestDb();
    const now = Date.now();
    const row = { id: uuidv7(), username: 'ana', passwordHash: 'h', role: 'admin' as const, createdAt: now, updatedAt: now };
    db.insert(users).values(row).run();
    expect(() => db.insert(users).values({ ...row, id: uuidv7() }).run()).toThrow();
  });
});
```

- [ ] **Step 6: Rodar e verificar**

Run: `yarn test tests/unit/db.test.ts`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---
