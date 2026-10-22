# review-bot — Plano 1: Fundação e Painel Administrativo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um sistema instalável com painel protegido, setup do root, usuários com papéis, definições (GitHub, perfis de IA, skills, webhooks), repositórios, dashboard e SSE.

**Architecture:** Monólito modular Node.js/TypeScript em um processo. Fastify serve API REST, SSE e o SPA React compilado; SQLite (better-sqlite3 + Drizzle) guarda tudo; migrations rodam no boot. O poller e o worker chegam no Plano 2.

**Tech Stack:** Node 22, TypeScript estrito, Fastify 5, Drizzle ORM + better-sqlite3, zod, pino, @node-rs/argon2, uuid v7, React 19 + Vite + Tailwind v4 + React Router 7 + TanStack Query 5, Vitest 3, tsup, Docker.

**Spec:** `docs/superpowers/specs/2026-10-22-pr-review-agent-design.md`

## Global Constraints

- Node >= 22, ESM (`"type": "module"`), Yarn 4 via Corepack (`packageManager: yarn@4.5.1`, `.yarnrc.yml` com `nodeLinker: node-modules`).
- TypeScript estrito com `noUncheckedIndexedAccess`.
- Sem comentários no código.
- IDs UUIDv7 (`import { v7 as uuidv7 } from 'uuid'`); datas em epoch ms (`Date.now()`).
- UI em português do Brasil.
- Não existe repositório git neste projeto (instrução do usuário): cada tarefa termina com checkpoint de verificação, não com commit.
- Segredos cifrados com AES-256-GCM e nunca devolvidos pela API.
- Toda rota valida entrada com zod.
- Testes com Vitest; rotas com `app.inject`; testes de componente com docblock `// @vitest-environment jsdom`.
- `APP_ENCRYPTION_KEY` obrigatória (32 bytes em base64); `DATA_DIR` padrão `./data`; `PORT` padrão 3000.
- Cookie de sessão: `prr_session`; sessão ociosa 12 h; absoluta 7 dias.
- Tabelas/colunas em snake_case; tipos TS em camelCase.
- Nome da imagem Docker: `review-bot`; volume `data` montado em `/data`.
- UI em tema escuro, conforme `design/review-bot-mockups.figcraft` (página escura). Os tokens estão na seção abaixo; onde os exemplos de código deste plano mostram classes claras, aplicar o token correspondente.

## Design tokens (tema escuro)

| Uso | Token |
|---|---|
| Fundo da aplicação | `bg-slate-950` (`#020617`) |
| Fundo de tela/conteúdo | `bg-slate-950` ou `bg-[#0b1220]` |
| Superfície de card | `bg-slate-900` (`#0f172a`) |
| Borda | `border-slate-800` (`#1e293b`) |
| Borda de input | `border-slate-700` (`#334155`) |
| Texto primário | `text-slate-100` (`#e2e8f0`) |
| Texto secundário | `text-slate-400` (`#94a3b8`) |
| Texto muted | `text-slate-500` (`#64748b`) |
| Input | `bg-slate-800` + `text-slate-100` |
| Botão primário | `bg-slate-200 text-slate-900 hover:bg-white` |
| Botão secundário | `border border-slate-700 text-slate-300` |
| Código/bloco | `bg-slate-950 border border-slate-800 font-mono` |
| Severidade crítica | `bg-red-950 text-red-300` |
| Severidade média | `bg-amber-950 text-amber-300` |
| Severidade sugestão | `bg-blue-950 text-blue-300` |
| Ponto forte | `bg-emerald-950 text-emerald-300` |

Regras: `body` com `bg-slate-950 text-slate-100`; nenhum card branco; ícones/realces em slate; foco visível em `ring-sky-400`. A página de setup e login usa o mesmo tema.

## File Map

```
package.json, tsconfig.json, vitest.config.ts, eslint.config.js, drizzle.config.ts
Dockerfile, docker-compose.yml, .env.example, .dockerignore, README.md
drizzle/                          migrations geradas pelo drizzle-kit
src/
  server.ts                       bootstrap (config, db, migrations, token, listen)
  config.ts                       env com zod
  logger.ts                       pino com redaction
  api/
    app.ts                        buildApp(deps) com plugins e rotas
    errors.ts                     erros de aplicação e handler
    plugins/security.ts           cookie, helmet/CSP, origin check, rate limit
    routes/health.ts              /healthz e /readyz
    routes/setup.ts               setup do root
    routes/auth.ts                login, logout, me, password
    routes/users.ts               CRUD de usuários
    routes/settings-github.ts     credencial GitHub
    routes/ai-profiles.ts         perfis de IA
    routes/skills.ts              skills
    routes/webhooks.ts            webhooks e entregas
    routes/repositories.ts        repositórios
    routes/dashboard.ts           métricas
    routes/events.ts              SSE
  db/
    schema.ts                     todas as tabelas
    client.ts                     createDb
    migrate.ts                    runMigrations
    settings.ts                   getSetting/setSetting
  auth/
    crypto.ts                     AES-256-GCM, hash de token
    password.ts                   argon2id
    sessions.ts                   criar/resolver/destruir sessão
    guards.ts                     requireAuth, requireRole
    setup.ts                      token de setup e criação do root
  audit/audit.ts                  log de auditoria
  shared/
    url-guard.ts                  validação SSRF
    validation.ts                 schemas zod comuns
  github/
    client.ts                     fetch autenticado mínimo
    credentials.ts                credencial e teste de conexão
  ai/
    adapters/types.ts             contrato de adaptador
    adapters/openai-compatible.ts teste de conexão OpenAI-compatible
    adapters/anthropic.ts         teste de conexão Anthropic
    adapters/index.ts             getAdapter
    profiles.ts                   CRUD de perfis
  webhooks/
    sign.ts                       HMAC-SHA256
    dispatcher.ts                 entrega com retry e log
  events/bus.ts                   barramento em memória para SSE
  types/fastify.d.ts              augmentação de FastifyRequest
  web/                            SPA React (Vite)
tests/
  helpers/db.ts                   banco em memória migrado
  helpers/app.ts                  buildApp de teste com deps falsas
  unit/...
  integration/...
```

---

### Task 1: Scaffold do projeto e /healthz

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `.yarnrc.yml`
- Create: `src/api/app.ts`, `src/api/routes/health.ts`
- Test: `tests/integration/health.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `buildApp(): FastifyInstance` em `src/api/app.ts`.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "review-bot",
  "private": true,
  "type": "module",
  "packageManager": "yarn@4.5.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "dev:web": "vite",
    "build": "yarn build:web && yarn build:server",
    "build:web": "vite build",
    "build:server": "tsup src/server.ts --format esm --platform node --target node22 --out-dir dist/server --external better-sqlite3 --external @node-rs/argon2",
    "start": "node dist/server/server.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate"
  },
  "dependencies": {
    "@fastify/cookie": "^11.0.0",
    "@fastify/helmet": "^13.0.0",
    "@fastify/rate-limit": "^10.0.0",
    "@fastify/static": "^8.0.0",
    "@node-rs/argon2": "^2.0.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@tanstack/react-query": "^5.0.0",
    "better-sqlite3": "^11.0.0",
    "drizzle-orm": "^0.44.0",
    "fastify": "^5.0.0",
    "pino": "^9.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "uuid": "^11.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@testing-library/dom": "^10.0.0",
    "@testing-library/jest-dom": "^6.0.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.0.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "drizzle-kit": "^0.31.0",
    "eslint": "^9.0.0",
    "jsdom": "^25.0.0",
    "pino-pretty": "^13.0.0",
    "tailwindcss": "^4.0.0",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "typescript-eslint": "^8.0.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Criar `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "drizzle.config.ts", "vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Criar `vitest.config.ts`, `eslint.config.js`, `.gitignore` e `.yarnrc.yml`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
```

```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'drizzle', 'node_modules'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
```

```
node_modules/
dist/
data/
.env
coverage/
.yarn/
```

`.yarnrc.yml`:

```yaml
nodeLinker: node-modules
```

- [ ] **Step 4: Criar `tests/setup.ts`**

```ts
process.env.APP_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
process.env.NODE_ENV = 'test';
```

- [ ] **Step 5: Escrever o teste que falha**

`tests/integration/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api/app';

describe('GET /healthz', () => {
  it('responde ok', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
```

- [ ] **Step 6: Rodar e verificar a falha**

Run: `yarn install; yarn test tests/integration/health.test.ts`
Expected: FAIL com "Cannot find module '../../src/api/app'".

- [ ] **Step 7: Implementar `src/api/app.ts` e `src/api/routes/health.ts`**

`src/api/routes/health.ts`:

```ts
import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async () => ({ status: 'ok' }));
}
```

`src/api/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoutes } from './routes/health';

export function buildApp(): FastifyInstance {
  const app = Fastify();
  registerHealthRoutes(app);
  return app;
}
```

- [ ] **Step 8: Rodar o teste**

Run: `yarn test tests/integration/health.test.ts`
Expected: PASS.

- [ ] **Step 9: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 2: Configuração e logger

**Files:**
- Create: `src/config.ts`, `src/logger.ts`
- Test: `tests/unit/config.test.ts`, `tests/unit/logger.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config`; `createLogger(config: Config, destination?: DestinationStream): Logger`. `Config` tem os campos do env mais `isProduction` e `isTest`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const base = {
  APP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  NODE_ENV: 'test',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('aplica padrões', () => {
    const config = loadConfig(base);
    expect(config.PORT).toBe(3000);
    expect(config.DATA_DIR).toBe('./data');
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.isTest).toBe(true);
  });

  it('converte booleanos textuais corretamente', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });

  it('exige chave de criptografia', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('exige PUBLIC_URL em produção', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/PUBLIC_URL/);
  });
});
```

- [ ] **Step 2: Rodar e verificar a falha**

Run: `yarn test tests/unit/config.test.ts`
Expected: FAIL com "Cannot find module '../../src/config'".

- [ ] **Step 3: Implementar `src/config.ts`**

```ts
import { z } from 'zod';

const BooleanFromEnv = z.enum(['true', 'false']).transform((value) => value === 'true');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default('./data'),
  PUBLIC_URL: z.string().url().optional(),
  APP_ENCRYPTION_KEY: z.string().min(1),
  SETUP_TOKEN: z.string().min(16).optional(),
  TRUST_PROXY: BooleanFromEnv.default('false'),
  ALLOW_PRIVATE_URLS: BooleanFromEnv.default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TZ: z.string().default('UTC'),
});

export type Config = z.infer<typeof EnvSchema> & { isProduction: boolean; isTest: boolean };

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Configuração inválida: ${details}`);
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.PUBLIC_URL) {
    throw new Error('PUBLIC_URL é obrigatória em produção');
  }
  return {
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
  };
}
```

- [ ] **Step 4: Implementar `src/logger.ts`**

```ts
import { pino, type DestinationStream, type Logger } from 'pino';
import type { Config } from './config';

export function createLogger(config: Config, destination?: DestinationStream): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: [
      'authorization',
      'cookie',
      'apiKey',
      'token',
      'password',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.token',
      'req.body.password',
      'req.body.apiKey',
      'headers.authorization',
      'headers.cookie',
      '*.apiKey',
      '*.token',
      '*.password',
    ],
  }, destination);
}
```

- [ ] **Step 4b: Escrever `tests/unit/logger.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createLogger } from '../../src/logger';
import { loadConfig } from '../../src/config';

describe('logger', () => {
  it('redige segredos em chaves de topo, aninhadas e no corpo', () => {
    const chunks: string[] = [];
    const logger = createLogger(loadConfig({ ...process.env, NODE_ENV: 'test' }), { write: (chunk: string) => chunks.push(chunk) });
    logger.info({ token: 'ghp_segredo_de_teste', password: 'senha_secreta', apiKey: 'sk_segredo', nested: { token: 'nested_segredo' }, req: { body: { token: 'body_segredo' } } }, 'teste');
    const output = chunks.join('');
    for (const secret of ['ghp_segredo_de_teste', 'senha_secreta', 'sk_segredo', 'nested_segredo', 'body_segredo']) {
      expect(output).not.toContain(secret);
    }
  });
});
```

- [ ] **Step 5: Rodar o teste**

Run: `yarn test tests/unit/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

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

### Task 4: Criptografia de segredos e senhas

**Files:**
- Create: `src/auth/crypto.ts`, `src/auth/password.ts`
- Test: `tests/unit/crypto.test.ts`, `tests/unit/password.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `loadEncryptionKey(base64): Buffer`; `encryptSecret(key, plaintext): string`; `decryptSecret(key, payload): string`; `hashToken(token): string`; `constantTimeEqualHex(a, b): boolean`; `hashPassword(password): Promise<string>`; `verifyPassword(hash, password): Promise<boolean>`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/unit/crypto.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { constantTimeEqualHex, decryptSecret, encryptSecret, hashToken, loadEncryptionKey } from '../../src/auth/crypto';

const key = loadEncryptionKey('MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=');

describe('crypto', () => {
  it('cifra e decifra preservando o texto', () => {
    const payload = encryptSecret(key, 'ghp_segredo');
    expect(payload.startsWith('v1:')).toBe(true);
    expect(payload).not.toContain('ghp_segredo');
    expect(decryptSecret(key, payload)).toBe('ghp_segredo');
  });

  it('gera IVs diferentes', () => {
    expect(encryptSecret(key, 'a')).not.toBe(encryptSecret(key, 'a'));
  });

  it('rejeita chave de tamanho errado', () => {
    expect(() => loadEncryptionKey('YWJj')).toThrow(/32 bytes/);
  });

  it('detecta payload adulterado', () => {
    const payload = encryptSecret(key, 'a');
    const tampered = `${payload.slice(0, -2)}AA`;
    expect(() => decryptSecret(key, tampered)).toThrow();
  });

  it('compara hashes em tempo constante', () => {
    expect(constantTimeEqualHex(hashToken('a'), hashToken('a'))).toBe(true);
    expect(constantTimeEqualHex(hashToken('a'), hashToken('b'))).toBe(false);
  });
});
```

`tests/unit/password.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password';

describe('password', () => {
  it('gera hash verificável', async () => {
    const hash = await hashPassword('senha-muito-forte');
    expect(hash).not.toBe('senha-muito-forte');
    expect(await verifyPassword(hash, 'senha-muito-forte')).toBe(true);
    expect(await verifyPassword(hash, 'outra-senha')).toBe(false);
  });

  it('retorna false para hash inválido', async () => {
    expect(await verifyPassword('nao-e-hash', 'x')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e verificar a falha**

Run: `yarn test tests/unit/crypto.test.ts tests/unit/password.test.ts`
Expected: FAIL com módulos não encontrados.

- [ ] **Step 3: Implementar `src/auth/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

export function loadEncryptionKey(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) {
    throw new Error('APP_ENCRYPTION_KEY deve ter 32 bytes em base64');
  }
  return key;
}

export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

export function decryptSecret(key: Buffer, payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(':');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Payload cifrado inválido');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
```

- [ ] **Step 4: Implementar `src/auth/password.ts`**

```ts
import { hash, verify } from '@node-rs/argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Rodar os testes**

Run: `yarn test tests/unit/crypto.test.ts tests/unit/password.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 5: Setup do root com token de setup

**Files:**
- Create: `src/api/errors.ts`, `src/auth/setup.ts`, `src/api/routes/setup.ts`
- Modify: `src/api/app.ts` (assinar `buildApp(deps)` e registrar rotas)
- Create: `tests/helpers/app.ts`
- Modify: `tests/integration/health.test.ts` (usar o helper)
- Test: `tests/integration/setup.test.ts`

**Interfaces:**
- Consumes: `Db`, `getSetting`, `setSetting`, `hashToken`, `constantTimeEqualHex`, `hashPassword`.
- Produces: `AppDeps = { db: Db; config: Config; logger: Logger; encryptionKey: Buffer }` em `src/api/app.ts`; `buildApp(deps: AppDeps): FastifyInstance`; `isSetupComplete(db)`; `ensureSetupToken(db, logger, envToken?)`; `completeSetup(db, { token, username, password }): Promise<{ userId: string }>`; `SetupError` com `statusCode`; `createTestApp(): Promise<{ app, db, deps }>` em `tests/helpers/app.ts`.

- [ ] **Step 1: Implementar `src/api/errors.ts`**

```ts
export class AppError extends Error {
  constructor(message: string, readonly code: string, readonly statusCode: number) {
    super(message);
  }
}

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } };
}
```

- [ ] **Step 2: Implementar `src/auth/setup.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { appSettings, users } from '../db/schema';
import { getSetting, setSetting } from '../db/settings';
import { constantTimeEqualHex, hashToken } from './crypto';
import { AppError } from '../api/errors';
import { hashPassword } from './password';

const SETUP_COMPLETE_KEY = 'setup_complete';
const SETUP_TOKEN_HASH_KEY = 'setup_token_hash';

export function isSetupComplete(db: Db): boolean {
  return getSetting<boolean>(db, SETUP_COMPLETE_KEY) === true;
}

export function ensureSetupToken(db: Db, logger: Logger, envToken?: string): void {
  if (isSetupComplete(db)) {
    return;
  }
  const existingHash = getSetting<string>(db, SETUP_TOKEN_HASH_KEY);
  if (existingHash && !envToken) {
    return;
  }
  if (envToken && existingHash === hashToken(envToken)) {
    return;
  }
  const token = envToken ?? randomBytes(32).toString('base64url');
  setSetting(db, SETUP_TOKEN_HASH_KEY, hashToken(token));
  logger.warn(`Token de setup (uso único): ${token}`);
}

export async function completeSetup(db: Db, input: { token: string; username: string; password: string }): Promise<{ userId: string }> {
  if (isSetupComplete(db)) {
    throw new AppError('Setup já concluído', 'setup_already_complete', 409);
  }
  const storedHash = getSetting<string>(db, SETUP_TOKEN_HASH_KEY);
  if (!storedHash || !constantTimeEqualHex(hashToken(input.token), storedHash)) {
    throw new AppError('Token de setup inválido', 'invalid_setup_token', 401);
  }
  const passwordHash = await hashPassword(input.password);
  const userId = uuidv7();
  const now = Date.now();
  db.transaction((tx) => {
    const complete = tx.select().from(appSettings).where(eq(appSettings.key, SETUP_COMPLETE_KEY)).get();
    if (complete) {
      throw new AppError('Setup já concluído', 'setup_already_complete', 409);
    }
    const tokenRow = tx.select().from(appSettings).where(eq(appSettings.key, SETUP_TOKEN_HASH_KEY)).get();
    const currentHash = tokenRow ? (JSON.parse(tokenRow.valueJson) as string) : undefined;
    if (!currentHash || !constantTimeEqualHex(hashToken(input.token), currentHash)) {
      throw new AppError('Token de setup inválido', 'invalid_setup_token', 401);
    }
    tx.insert(users)
      .values({
        id: userId,
        username: input.username.toLowerCase(),
        passwordHash,
        role: 'admin',
        isRoot: true,
        disabled: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    tx.insert(appSettings)
      .values({ key: SETUP_COMPLETE_KEY, valueJson: 'true', updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { valueJson: 'true', updatedAt: now } })
      .run();
    tx.delete(appSettings).where(eq(appSettings.key, SETUP_TOKEN_HASH_KEY)).run();
  });
  return { userId };
}
```

- [ ] **Step 3: Implementar `src/api/routes/setup.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { completeSetup, isSetupComplete } from '../../auth/setup';

const SetupBody = z.object({
  token: z.string().min(1),
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(12).max(200),
});

export function registerSetupRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/setup/status', async () => ({ needsSetup: !isSetupComplete(deps.db) }));

  app.post('/api/setup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = SetupBody.parse(request.body);
    const result = await completeSetup(deps.db, body);
    deps.logger.info({ userId: result.userId }, 'root criado');
    return reply.code(201).send({ userId: result.userId });
  });
}
```

- [ ] **Step 4: Modificar `src/api/app.ts` para receber dependências**

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import type { Logger } from 'pino';
import { AppError, errorBody } from './errors';
import { registerHealthRoutes } from './routes/health';
import { registerSetupRoutes } from './routes/setup';

export type AppDeps = {
  db: Db;
  config: Config;
  logger: Logger;
  encryptionKey: Buffer;
};

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ loggerInstance: deps.logger, trustProxy: deps.config.TRUST_PROXY, forceCloseConnections: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }
    if (error instanceof ZodError) {
      return reply.code(400).send(errorBody('validation_error', 'Dados inválidos', error.issues));
    }
    deps.logger.error({ err: error }, 'erro não tratado');
    return reply.code(500).send(errorBody('internal_error', 'Erro interno'));
  });

  registerHealthRoutes(app);
  registerSetupRoutes(app, deps);
  return app;
}
```

- [ ] **Step 5: Criar `tests/helpers/app.ts` e atualizar o teste de health**

`tests/helpers/app.ts`:

```ts
import { buildApp, type AppDeps } from '../../src/api/app';
import { loadConfig } from '../../src/config';
import { createTestDb } from './db';
import { createLogger } from '../../src/logger';
import { loadEncryptionKey } from '../../src/auth/crypto';
import { ensureSetupToken } from '../../src/auth/setup';

export function createTestDeps(): AppDeps {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
  return {
    db: createTestDb(),
    config,
    logger: createLogger(config),
    encryptionKey: loadEncryptionKey(process.env.APP_ENCRYPTION_KEY ?? ''),
  };
}

export function createTestApp(): { app: ReturnType<typeof buildApp>; deps: AppDeps } {
  const deps = createTestDeps();
  ensureSetupToken(deps.db, deps.logger, 'token-de-setup-de-teste-123456');
  return { app: buildApp(deps), deps };
}
```

Atualizar `tests/integration/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';

describe('GET /healthz', () => {
  it('responde ok', async () => {
    const { app } = createTestApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
```

- [ ] **Step 6: Escrever o teste que falha de setup**

`tests/integration/setup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp } from '../helpers/app';
import { appSettings, users } from '../../src/db/schema';

const body = { token: 'token-de-setup-de-teste-123456', username: 'root', password: 'senha-muito-segura' };

describe('setup', () => {
  it('indica que o setup é necessário', async () => {
    const { app } = createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(response.json()).toEqual({ needsSetup: true });
    await app.close();
  });

  it('rejeita token inválido', async () => {
    const { app } = createTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/setup', payload: { ...body, token: 'errado-errado-errado' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_setup_token');
    await app.close();
  });

  it('cria o root e encerra o setup', async () => {
    const { app, deps } = createTestApp();
    const created = await app.inject({ method: 'POST', url: '/api/setup', payload: body });
    expect(created.statusCode).toBe(201);
    expect(created.json().userId).toBeTruthy();
    const root = deps.db.select().from(users).get()!;
    expect(root.username).toBe('root');
    expect(root.role).toBe('admin');
    expect(root.isRoot).toBe(true);
    expect(deps.db.select().from(appSettings).where(eq(appSettings.key, 'setup_token_hash')).get()).toBeUndefined();
    const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json()).toEqual({ needsSetup: false });
    const again = await app.inject({ method: 'POST', url: '/api/setup', payload: { ...body, username: 'outro' } });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it('rejeita setup concorrente', async () => {
    const { app } = createTestApp();
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/setup', payload: body }),
      app.inject({ method: 'POST', url: '/api/setup', payload: { ...body, username: 'root2' } }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    await app.close();
  });

  it('valida senha mínima', async () => {
    const { app } = createTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/setup', payload: { ...body, password: 'curta' } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 7: Rodar e verificar**

Run: `yarn test tests/integration/setup.test.ts tests/integration/health.test.ts`
Expected: PASS.

- [ ] **Step 8: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

### Task 6: Sessões, login, guards e plugins de segurança

**Files:**
- Create: `src/auth/sessions.ts`, `src/auth/guards.ts`, `src/types/fastify.d.ts`, `src/api/plugins/security.ts`, `src/api/routes/auth.ts`
- Modify: `src/api/app.ts`, `src/api/routes/setup.ts`
- Create: `tests/helpers/auth.ts`
- Test: `tests/integration/auth.test.ts`, `tests/unit/origin.test.ts`

**Interfaces:**
- Consumes: `Db`, `hashToken`, `verifyPassword`, `hashPassword`, `AppError`.
- Produces: `createSession(db, userId, meta): { token: string; sessionId: string }`; `resolveSession(db, token): { user: PublicUser } | undefined`; `destroySession(db, token): void`; `revokeUserSessions(db, userId): void`; `setSessionCookie(reply, token, config): void`; `clearSessionCookie(reply): void`; `requireAuth(deps)` e `requireRole(...roles)` como preHandlers; `isAllowedOrigin(origin, host, publicUrl): boolean`; `setupRootAndLogin(app, deps): Promise<string>` (helper de teste que devolve o header Cookie).

- [ ] **Step 1: Implementar `src/auth/sessions.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { FastifyReply } from 'fastify';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { sessions, users } from '../db/schema';
import { hashToken } from './crypto';

export const SESSION_COOKIE = 'prr_session';
const IDLE_MS = 12 * 60 * 60 * 1000;
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;

export type PublicUser = {
  id: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  isRoot: boolean;
};

export function createSession(db: Db, userId: string, meta: { ip?: string; userAgent?: string }): { token: string; sessionId: string } {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const sessionId = uuidv7();
  db.insert(sessions)
    .values({
      id: sessionId,
      userId,
      tokenHash: hashToken(token),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: now + IDLE_MS,
      absoluteExpiresAt: now + ABSOLUTE_MS,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
    .run();
  return { token, sessionId };
}

export function resolveSession(db: Db, token: string): { user: PublicUser; absoluteExpiresAt: number } | undefined {
  const row = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();
  if (!row) {
    return undefined;
  }
  const now = Date.now();
  if (now > row.idleExpiresAt || now > row.absoluteExpiresAt) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
    return undefined;
  }
  const user = db.select().from(users).where(eq(users.id, row.userId)).get();
  if (!user || user.disabled) {
    return undefined;
  }
  db.update(sessions)
    .set({ lastSeenAt: now, idleExpiresAt: now + IDLE_MS })
    .where(eq(sessions.id, row.id))
    .run();
  return { user: { id: user.id, username: user.username, role: user.role, isRoot: user.isRoot }, absoluteExpiresAt: row.absoluteExpiresAt };
}

export function destroySession(db: Db, token: string): void {
  db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

export function revokeUserSessions(db: Db, userId: string): void {
  db.delete(sessions).where(eq(sessions.userId, userId)).run();
}

export function purgeExpiredSessions(db: Db): void {
  db.delete(sessions).where(lt(sessions.absoluteExpiresAt, Date.now())).run();
}

export function setSessionCookie(reply: FastifyReply, token: string, config: Config, absoluteExpiresAt?: number): void {
  const now = Date.now();
  const remaining = (absoluteExpiresAt ?? now + ABSOLUTE_MS) - now;
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction && (config.PUBLIC_URL?.startsWith('https://') ?? false),
    maxAge: Math.max(60, Math.floor(Math.min(IDLE_MS, remaining) / 1000)),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
```

- [ ] **Step 2: Implementar `src/types/fastify.d.ts` e `src/auth/guards.ts`**

`src/types/fastify.d.ts`:

```ts
import type { PublicUser } from '../auth/sessions';

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
    sessionToken?: string;
  }
}
```

`src/auth/guards.ts`:

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../api/errors';
import type { AppDeps } from '../api/app';
import { SESSION_COOKIE, clearSessionCookie, resolveSession, setSessionCookie } from './sessions';

export function requireAuth(deps: AppDeps) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      throw new AppError('Autenticação necessária', 'unauthenticated', 401);
    }
    const resolved = resolveSession(deps.db, token);
    if (!resolved) {
      clearSessionCookie(reply);
      throw new AppError('Sessão inválida ou expirada', 'invalid_session', 401);
    }
    setSessionCookie(reply, token, deps.config, resolved.absoluteExpiresAt);
    request.user = resolved.user;
    request.sessionToken = token;
  };
}

export function requireRole(deps: AppDeps, ...roles: Array<'admin' | 'operator' | 'viewer'>) {
  const auth = requireAuth(deps);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await auth(request, reply);
    const user = request.user;
    if (!user || !roles.includes(user.role)) {
      throw new AppError('Permissão insuficiente', 'forbidden', 403);
    }
  };
}
```

- [ ] **Step 3: Implementar `src/api/plugins/security.ts`**

```ts
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppDeps } from '../app';
import { AppError } from '../errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isAllowedOrigin(origin: string, host: string | undefined, publicUrl: string | undefined): boolean {
  let expected: string;
  if (publicUrl) {
    expected = new URL(publicUrl).origin;
  } else if (host) {
    expected = `http://${host}`;
  } else {
    return false;
  }
  return origin === expected;
}

export async function registerSecurityPlugin(app: FastifyInstance, deps: AppDeps): Promise<void> {
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: deps.config.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
          },
        }
      : false,
  });
  await app.register(rateLimit, { global: false });

  app.addHook('onRequest', async (request: FastifyRequest) => {
    if (!MUTATING.has(request.method)) {
      return;
    }
    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin, request.headers.host, deps.config.PUBLIC_URL)) {
      throw new AppError('Origem não permitida', 'invalid_origin', 403);
    }
  });
}
```

- [ ] **Step 4: Implementar `src/api/routes/auth.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { users } from '../../db/schema';
import { hashPassword, verifyPassword } from '../../auth/password';
import { clearSessionCookie, createSession, destroySession, revokeUserSessions, setSessionCookie } from '../../auth/sessions';
import { requireAuth } from '../../auth/guards';

const LoginBody = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });
const PasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(12).max(200) });

function publicUser(user: { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; isRoot: boolean }) {
  return { id: user.id, username: user.username, role: user.role, isRoot: user.isRoot };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request: FastifyRequest) => {
    const parsed = LoginBody.safeParse(request.body);
    const username = parsed.success ? parsed.data.username.toLowerCase().slice(0, 64) : 'invalid';
    return `${request.ip}:${username}`;
  } } } }, async (request, reply) => {
    const body = LoginBody.parse(request.body);
    const user = deps.db.select().from(users).where(eq(users.username, body.username.toLowerCase())).get();
    if (!user || user.disabled) {
      throw new AppError('Credenciais inválidas', 'invalid_credentials', 401);
    }
    const valid = await verifyPassword(user.passwordHash, body.password);
    if (!valid) {
      throw new AppError('Credenciais inválidas', 'invalid_credentials', 401);
    }
    deps.db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
    const { token } = createSession(deps.db, user.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, token, deps.config);
    return reply.send({ user: publicUser(user) });
  });

  app.post('/api/auth/logout', { preHandler: requireAuth(deps) }, async (request, reply) => {
    if (request.sessionToken) {
      destroySession(deps.db, request.sessionToken);
    }
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { preHandler: requireAuth(deps) }, async (request) => ({ user: request.user }));

  app.post('/api/auth/password', { preHandler: requireAuth(deps) }, async (request, reply) => {
    const body = PasswordBody.parse(request.body);
    const user = deps.db.select().from(users).where(eq(users.id, request.user?.id ?? '')).get();
    if (!user) {
      throw new AppError('Usuário não encontrado', 'user_not_found', 404);
    }
    const valid = await verifyPassword(user.passwordHash, body.currentPassword);
    if (!valid) {
      throw new AppError('Senha atual incorreta', 'invalid_current_password', 400);
    }
    const passwordHash = await hashPassword(body.newPassword);
    deps.db.update(users).set({ passwordHash, updatedAt: Date.now() }).where(eq(users.id, user.id)).run();
    revokeUserSessions(deps.db, user.id);
    const { token } = createSession(deps.db, user.id, { ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, token, deps.config);
    return reply.code(204).send();
  });
}
```

- [ ] **Step 5: Modificar `src/api/app.ts` e `src/api/routes/setup.ts`**

Em `src/api/app.ts`, importar `registerSecurityPlugin`, `registerAuthRoutes` e registrar antes das rotas, dentro de `buildApp` (que passa a ser `async`):

```ts
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: deps.logger, trustProxy: deps.config.TRUST_PROXY, forceCloseConnections: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }
    if (error instanceof ZodError) {
      return reply.code(400).send(errorBody('validation_error', 'Dados inválidos', error.issues));
    }
    deps.logger.error({ err: error }, 'erro não tratado');
    return reply.code(500).send(errorBody('internal_error', 'Erro interno'));
  });

  await registerSecurityPlugin(app, deps);
  registerHealthRoutes(app);
  registerSetupRoutes(app, deps);
  registerAuthRoutes(app, deps);
  return app;
}
```

Em `src/api/routes/setup.ts`, adicionar os imports `createSession` e `setSessionCookie` de `../../auth/sessions` e, após `completeSetup`, criar sessão e cookie (auto-login):

```ts
    const result = await completeSetup(deps.db, body);
    const { token } = createSession(deps.db, result.userId, { ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, token, deps.config);
    deps.logger.info({ userId: result.userId }, 'root criado');
    return reply.code(201).send({ userId: result.userId });
```

Atualizar `tests/helpers/app.ts` para `buildApp` assíncrono:

```ts
export async function createTestApp(): Promise<{ app: FastifyInstance; deps: AppDeps }> {
  const deps = createTestDeps();
  ensureSetupToken(deps.db, deps.logger, 'token-de-setup-de-teste-123456');
  return { app: await buildApp(deps), deps };
}
```

Atualizar todos os testes que usam `createTestApp` para `const { app } = await createTestApp();`.

- [ ] **Step 6: Criar `tests/helpers/auth.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../src/api/app';

export const SETUP_TOKEN = 'token-de-setup-de-teste-123456';
export const ROOT_PASSWORD = 'senha-muito-segura';

export async function setupRootAndLogin(app: FastifyInstance, _deps: AppDeps): Promise<string> {
  const setup = await app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { token: SETUP_TOKEN, username: 'root', password: ROOT_PASSWORD },
  });
  if (setup.statusCode !== 201) {
    throw new Error(`setup falhou: ${setup.body}`);
  }
  const login = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: 'root', password: ROOT_PASSWORD },
  });
  if (login.statusCode !== 200) {
    throw new Error(`login falhou: ${login.body}`);
  }
  const cookie = login.cookies.find((item) => item.name === 'prr_session');
  if (!cookie) {
    throw new Error('cookie de sessão ausente');
  }
  return `prr_session=${cookie.value}`;
}
```

- [ ] **Step 7: Escrever os testes**

`tests/unit/origin.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../../src/api/plugins/security';

describe('isAllowedOrigin', () => {
  it('aceita a origem pública configurada', () => {
    expect(isAllowedOrigin('https://bot.exemplo.com', 'interno:3000', 'https://bot.exemplo.com')).toBe(true);
  });

  it('rejeita origem diferente', () => {
    expect(isAllowedOrigin('https://malicioso.com', 'bot.exemplo.com', 'https://bot.exemplo.com')).toBe(false);
  });

  it('usa o host quando não há PUBLIC_URL', () => {
    expect(isAllowedOrigin('http://localhost:3000', 'localhost:3000', undefined)).toBe(true);
    expect(isAllowedOrigin('http://localhost:9999', 'localhost:3000', undefined)).toBe(false);
  });

  it('rejeita quando não há referência', () => {
    expect(isAllowedOrigin('http://x', undefined, undefined)).toBe(false);
  });
});
```

`tests/integration/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { ROOT_PASSWORD, setupRootAndLogin } from '../helpers/auth';

describe('autenticação', () => {
  it('faz login, retorna me e faz logout', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('root');
    expect(me.json().user.isRoot).toBe(true);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  it('rejeita credenciais inválidas', async () => {
    const { app, deps } = await createTestApp();
    await setupRootAndLogin(app, deps);
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'errada' } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('bloqueia acesso sem sessão', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('troca de senha invalida sessões antigas', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const change = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie },
      payload: { currentPassword: ROOT_PASSWORD, newPassword: 'outra-senha-muito-longa' },
    });
    expect(change.statusCode).toBe(204);
    const old = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(old.statusCode).toBe(401);
    const relogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'outra-senha-muito-longa' } });
    expect(relogin.statusCode).toBe(200);
    await app.close();
  });

  it('rejeita origem cruzada em mutações', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://malicioso.com' },
      payload: { username: 'x', password: 'y' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] **Step 8: Rodar e verificar**

Run: `yarn test tests/unit/origin.test.ts tests/integration/auth.test.ts tests/integration/setup.test.ts`
Expected: PASS.

- [ ] **Step 9: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 7: Usuários e auditoria

**Files:**
- Create: `src/audit/audit.ts`, `src/api/routes/users.ts`
- Modify: `src/api/app.ts`
- Test: `tests/integration/users.test.ts`

**Interfaces:**
- Consumes: `Db`, `hashPassword`, guards.
- Produces: `audit(db, entry: { userId?: string; action: string; targetType?: string; targetId?: string; data?: unknown; ip?: string }): void`; `registerUserRoutes(app, deps)`.

- [ ] **Step 1: Implementar `src/audit/audit.ts`**

```ts
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { auditLog } from '../db/schema';

export type AuditEntry = {
  userId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  data?: unknown;
  ip?: string;
};

export function audit(db: Db, entry: AuditEntry): void {
  db.insert(auditLog)
    .values({
      id: uuidv7(),
      userId: entry.userId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      dataJson: entry.data === undefined ? null : JSON.stringify(entry.data),
      ip: entry.ip ?? null,
      createdAt: Date.now(),
    })
    .run();
}
```

- [ ] **Step 2: Implementar `src/api/routes/users.ts`**

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { users } from '../../db/schema';
import { hashPassword } from '../../auth/password';
import { requireRole } from '../../auth/guards';
import { revokeUserSessions } from '../../auth/sessions';
import { audit } from '../../audit/audit';
import { v7 as uuidv7 } from 'uuid';

const Role = z.enum(['admin', 'operator', 'viewer']);
const CreateBody = z.object({ username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/), password: z.string().min(12).max(200), role: Role });
const PatchBody = z.object({ role: Role.optional(), disabled: z.boolean().optional() });
const ResetBody = z.object({ password: z.string().min(12).max(200) });

function toPublic(row: { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; isRoot: boolean; disabled: boolean; createdAt: number; lastLoginAt: number | null }) {
  return { id: row.id, username: row.username, role: row.role, isRoot: row.isRoot, disabled: row.disabled, createdAt: row.createdAt, lastLoginAt: row.lastLoginAt };
}

function countActiveAdmins(db: AppDeps['db'], exceptId: string): number {
  return db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.disabled, false), eq(users.isRoot, false), ne(users.id, exceptId))).all().length;
}

export function registerUserRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/users', { preHandler: requireRole(deps, 'admin') }, async () => ({
    users: deps.db.select().from(users).all().map(toPublic),
  }));

  app.post('/api/users', { preHandler: requireRole(deps, 'admin') }, async (request, reply) => {
    const actor = request.user!;
    const body = CreateBody.parse(request.body);
    if (body.role === 'admin' && !actor.isRoot) {
      throw new AppError('Somente o root cria administradores', 'forbidden', 403);
    }
    const username = body.username.toLowerCase();
    const existing = deps.db.select().from(users).where(eq(users.username, username)).get();
    if (existing) {
      throw new AppError('Usuário já existe', 'username_taken', 409);
    }
    const passwordHash = await hashPassword(body.password);
    const now = Date.now();
    const id = uuidv7();
    deps.db.insert(users).values({ id, username, passwordHash, role: body.role, isRoot: false, disabled: false, createdAt: now, updatedAt: now }).run();
    audit(deps.db, { userId: actor.id, action: 'user.create', targetType: 'user', targetId: id, data: { username, role: body.role }, ip: request.ip });
    return reply.code(201).send({ user: toPublic(deps.db.select().from(users).where(eq(users.id, id)).get()!) });
  });

  app.patch('/api/users/:id', { preHandler: requireRole(deps, 'admin') }, async (request) => {
    const actor = request.user!;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = PatchBody.parse(request.body);
    const target = deps.db.select().from(users).where(eq(users.id, params.id)).get();
    if (!target) {
      throw new AppError('Usuário não encontrado', 'user_not_found', 404);
    }
    if (target.isRoot) {
      throw new AppError('O root não pode ser alterado', 'root_immutable', 403);
    }
    if ((target.role === 'admin' || body.role === 'admin') && !actor.isRoot) {
      throw new AppError('Somente o root gerencia administradores', 'forbidden', 403);
    }
    const demoting = (target.role === 'admin' && body.role !== undefined && body.role !== 'admin') || (target.role === 'admin' && body.disabled === true);
    if (demoting && countActiveAdmins(deps.db, target.id) === 0) {
      throw new AppError('É necessário ao menos um administrador ativo além do root', 'last_admin', 409);
    }
    const changes: { role?: 'admin' | 'operator' | 'viewer'; disabled?: boolean; updatedAt: number } = { updatedAt: Date.now() };
    if (body.role !== undefined) {
      changes.role = body.role;
    }
    if (body.disabled !== undefined) {
      changes.disabled = body.disabled;
    }
    deps.db.update(users).set(changes).where(eq(users.id, target.id)).run();
    if (changes.disabled === true) {
      revokeUserSessions(deps.db, target.id);
    }
    audit(deps.db, { userId: actor.id, action: 'user.update', targetType: 'user', targetId: target.id, data: changes, ip: request.ip });
    return { user: toPublic(deps.db.select().from(users).where(eq(users.id, target.id)).get()!) };
  });

  app.post('/api/users/:id/reset-password', { preHandler: requireRole(deps, 'admin') }, async (request, reply) => {
    const actor = request.user!;
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = ResetBody.parse(request.body);
    const target = deps.db.select().from(users).where(eq(users.id, params.id)).get();
    if (!target) {
      throw new AppError('Usuário não encontrado', 'user_not_found', 404);
    }
    if (target.isRoot && !actor.isRoot) {
      throw new AppError('Somente o root redefine a senha do root', 'forbidden', 403);
    }
    if (target.role === 'admin' && !actor.isRoot && !target.isRoot) {
      throw new AppError('Somente o root redefine senha de administradores', 'forbidden', 403);
    }
    const passwordHash = await hashPassword(body.password);
    deps.db.update(users).set({ passwordHash, updatedAt: Date.now() }).where(eq(users.id, target.id)).run();
    revokeUserSessions(deps.db, target.id);
    audit(deps.db, { userId: actor.id, action: 'user.reset_password', targetType: 'user', targetId: target.id, ip: request.ip });
    return reply.code(204).send();
  });
}
```

- [ ] **Step 3: Registrar em `src/api/app.ts`**

Adicionar `registerUserRoutes(app, deps);` junto das demais rotas.

- [ ] **Step 4: Escrever o teste**

`tests/integration/users.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

async function createUser(app: Awaited<ReturnType<typeof createTestApp>>['app'], cookie: string, role: string, username: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie },
    payload: { username, password: 'senha-muito-segura', role },
  });
  return response;
}

describe('usuários', () => {
  it('cria, lista e altera papel', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await createUser(app, cookie, 'viewer', 'ana');
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(list.json().users).toHaveLength(2);
    const id = created.json().user.id;
    const patched = await app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: { cookie }, payload: { role: 'operator' } });
    expect(patched.json().user.role).toBe('operator');
    await app.close();
  });

  it('impede root de criar admin sem ser root', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await createUser(app, cookie, 'admin', 'adm');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'adm', password: 'senha-muito-segura' } });
    const admCookie = `prr_session=${login.cookies.find((c) => c.name === 'prr_session')!.value}`;
    const response = await createUser(app, admCookie, 'admin', 'adm2');
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('protege o último administrador ativo', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await createUser(app, cookie, 'admin', 'adm');
    const id = created.json().user.id;
    const response = await app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: { cookie }, payload: { disabled: true } });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it('não altera o root', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const list = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    const root = list.json().users.find((u: { isRoot: boolean }) => u.isRoot);
    const response = await app.inject({ method: 'PATCH', url: `/api/users/${root.id}`, headers: { cookie }, payload: { disabled: true } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('viewer não acessa a lista', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await createUser(app, cookie, 'viewer', 'ana');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ana', password: 'senha-muito-segura' } });
    const viewerCookie = `prr_session=${login.cookies.find((c) => c.name === 'prr_session')!.value}`;
    const response = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: viewerCookie } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
```

- [ ] **Step 5: Rodar e verificar**

Run: `yarn test tests/integration/users.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 8: Validação de URLs (SSRF)

**Files:**
- Create: `src/shared/url-guard.ts`
- Test: `tests/unit/url-guard.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `assertSafeUrl(rawUrl: string, options?: { allowPrivate?: boolean; lookup?: LookupFn }): Promise<URL>`; `isPrivateAddress(ip: string): boolean`; `type LookupFn = (hostname: string) => Promise<string[]>`.

- [ ] **Step 1: Escrever o teste que falha**

`tests/unit/url-guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertSafeUrl, isPrivateAddress } from '../../src/shared/url-guard';

describe('isPrivateAddress', () => {
  it('identifica faixas privadas e especiais', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.1.1', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:0:0', '0:0:0:0:0:0:0:1', '64:ff9b::7f00:1', 'fec0::1', 'ff02::1', '2002:7f00:1::']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe('assertSafeUrl', () => {
  it('aceita https público', async () => {
    const url = await assertSafeUrl('https://api.openai.com/v1', { lookup: async () => ['93.184.216.34'] });
    expect(url.hostname).toBe('api.openai.com');
  });

  it('rejeita esquema não http', async () => {
    await expect(assertSafeUrl('ftp://exemplo.com', { lookup: async () => ['93.184.216.34'] })).rejects.toThrow(/http/);
  });

  it('rejeita host privado literal', async () => {
    await expect(assertSafeUrl('http://127.0.0.1:8080', { lookup: async () => ['127.0.0.1'] })).rejects.toThrow(/privado/);
  });

  it('rejeita IPv6 mapeado para loopback e metadata', async () => {
    await expect(assertSafeUrl('http://[::ffff:127.0.0.1]/')).rejects.toThrow(/privado/);
    await expect(assertSafeUrl('http://[::ffff:169.254.169.254]/')).rejects.toThrow(/privado/);
  });

  it('rejeita hostname que resolve para IP privado', async () => {
    await expect(assertSafeUrl('https://interno.exemplo.com', { lookup: async () => ['192.168.1.10'] })).rejects.toThrow(/privado/);
  });

  it('rejeita resolução vazia ou mista', async () => {
    await expect(assertSafeUrl('https://vazio.exemplo.com', { lookup: async () => [] })).rejects.toThrow(/resolvido/);
    await expect(assertSafeUrl('https://misto.exemplo.com', { lookup: async () => ['8.8.8.8', '10.0.0.5'] })).rejects.toThrow(/privado/);
  });

  it('permite privados quando allowPrivate', async () => {
    const url = await assertSafeUrl('http://10.0.0.5:11434/v1', { allowPrivate: true, lookup: async () => ['10.0.0.5'] });
    expect(url.port).toBe('11434');
  });
});
```

- [ ] **Step 2: Rodar e verificar a falha**

Run: `yarn test tests/unit/url-guard.test.ts`
Expected: FAIL com módulo não encontrado.

- [ ] **Step 3: Implementar `src/shared/url-guard.ts`**

```ts
import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

export type LookupFn = (hostname: string) => Promise<string[]>;

function ipv4ToBytes(ip: string): number[] {
  return ip.split('.').map((part) => Number(part));
}

function inRange(bytes: number[], network: number[], bits: number): boolean {
  const value = (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!;
  const netValue = (network[0]! << 24) | (network[1]! << 16) | (network[2]! << 8) | network[3]!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (netValue & mask);
}

function parseIpv6(ip: string): number[] | null {
  const clean = ip.includes('%') ? ip.slice(0, ip.indexOf('%')) : ip;
  const halves = clean.split('::');
  if (halves.length > 2) {
    return null;
  }
  const parseSide = (side: string): number[] | null => {
    if (!side) {
      return [];
    }
    const out: number[] = [];
    for (const part of side.split(':')) {
      if (part.includes('.')) {
        const v4 = part.split('.').map(Number);
        if (v4.length !== 4 || v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
          return null;
        }
        out.push((v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(part)) {
          return null;
        }
        out.push(parseInt(part, 16));
      }
    }
    return out;
  };
  const head = parseSide(halves[0] ?? '');
  if (!head) {
    return null;
  }
  if (halves.length === 1) {
    return head.length === 8 ? head : null;
  }
  const tail = parseSide(halves[1] ?? '');
  if (!tail) {
    return null;
  }
  const zeros = 8 - head.length - tail.length;
  if (zeros < 0) {
    return null;
  }
  return [...head, ...Array<number>(zeros).fill(0), ...tail];
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const bytes = ipv4ToBytes(ip);
    return (
      inRange(bytes, [0, 0, 0, 0], 8) ||
      inRange(bytes, [10, 0, 0, 0], 8) ||
      inRange(bytes, [100, 64, 0, 0], 10) ||
      inRange(bytes, [127, 0, 0, 0], 8) ||
      inRange(bytes, [169, 254, 0, 0], 16) ||
      inRange(bytes, [172, 16, 0, 0], 12) ||
      inRange(bytes, [192, 0, 0, 0], 24) ||
      inRange(bytes, [192, 168, 0, 0], 16) ||
      inRange(bytes, [198, 18, 0, 0], 15) ||
      inRange(bytes, [224, 0, 0, 0], 4) ||
      inRange(bytes, [240, 0, 0, 0], 4)
    );
  }
  if (isIP(ip) === 6) {
    const groups = parseIpv6(ip.toLowerCase());
    if (!groups) {
      return true;
    }
    if (groups.slice(0, 6).every((group) => group === 0)) {
      return true;
    }
    if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
      return isPrivateAddress(`${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`);
    }
    if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) {
      return true;
    }
    if ((groups[0]! & 0xfe00) === 0xfc00) {
      return true;
    }
    if ((groups[0]! & 0xffc0) === 0xfe80 || (groups[0]! & 0xffc0) === 0xfec0) {
      return true;
    }
    if ((groups[0]! & 0xff00) === 0xff00) {
      return true;
    }
    if (groups[0] === 0x2002 || (groups[0] === 0x2001 && groups[1] === 0)) {
      return true;
    }
    return false;
  }
  return true;
}

export async function assertSafeUrl(rawUrl: string, options: { allowPrivate?: boolean; lookup?: LookupFn } = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Apenas URLs http/https são permitidas');
  }
  if (options.allowPrivate) {
    return url;
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname) ? [hostname] : await (options.lookup ?? defaultLookup)(hostname);
  if (addresses.length === 0) {
    throw new Error('Endereço não resolvido');
  }
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`Endereço privado não permitido: ${address}`);
    }
  }
  return url;
}

async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}
```

- [ ] **Step 4: Rodar o teste**

Run: `yarn test tests/unit/url-guard.test.ts`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 9: Credencial GitHub e teste de conexão

**Files:**
- Create: `src/github/client.ts`, `src/github/credentials.ts`, `src/api/routes/settings-github.ts`
- Modify: `src/api/app.ts`
- Test: `tests/integration/github-settings.test.ts`

**Interfaces:**
- Consumes: `Db`, `encryptSecret`, `decryptSecret`, `assertSafeUrl` (não usado aqui; base fixa `api.github.com`), `AppError`.
- Produces: `githubFetch(path, { token, fetchImpl, method, body }): Promise<Response>`; `testConnection(pat, fetchImpl?): Promise<{ login: string; scopes: string }>`; `getGithubCredentials(db, key): { login: string; pat: string; patLast4: string; scopes: string } | undefined`; `saveGithubCredentials(db, key, input: { login: string; pat: string; scopes: string }): void`; `registerGithubSettingsRoutes(app, deps)`.

- [ ] **Step 1: Implementar `src/github/client.ts`**

```ts
const API_BASE = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message: string, readonly status: number, readonly bodyExcerpt: string) {
    super(message);
  }
}

export async function githubFetch(path: string, options: { token: string; fetchImpl?: typeof fetch; method?: string; body?: unknown }): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'review-bot',
      'x-github-api-version': '2022-11-28',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return response;
}
```

- [ ] **Step 2: Implementar `src/github/credentials.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { githubCredentials } from '../db/schema';
import { decryptSecret, encryptSecret } from '../auth/crypto';
import { AppError } from '../api/errors';
import { githubFetch } from './client';

export type GithubCredentials = { login: string; pat: string; patLast4: string; scopes: string };

export async function testConnection(pat: string, fetchImpl?: typeof fetch): Promise<{ login: string; scopes: string }> {
  const response = await githubFetch('/user', { token: pat, fetchImpl });
  if (!response.ok) {
    const excerpt = (await response.text()).slice(0, 200);
    throw new AppError(`Token rejeitado pelo GitHub (${response.status})`, 'invalid_github_token', 400);
  }
  const data = (await response.json()) as { login?: string };
  if (!data.login) {
    throw new AppError('Resposta inesperada do GitHub', 'invalid_github_response', 502);
  }
  return { login: data.login, scopes: response.headers.get('x-oauth-scopes') ?? '' };
}

export function getGithubCredentials(db: Db, key: Buffer): GithubCredentials | undefined {
  const row = db.select().from(githubCredentials).where(eq(githubCredentials.id, 'singleton')).get();
  if (!row) {
    return undefined;
  }
  return { login: row.login, pat: decryptSecret(key, row.patEncrypted), patLast4: row.patLast4, scopes: row.scopes ?? '' };
}

export function saveGithubCredentials(db: Db, key: Buffer, input: { login: string; pat: string; scopes: string }): void {
  const now = Date.now();
  const values = {
    id: 'singleton',
    login: input.login,
    patEncrypted: encryptSecret(key, input.pat),
    patLast4: input.pat.slice(-4),
    scopes: input.scopes,
    validatedAt: now,
    updatedAt: now,
  };
  db.insert(githubCredentials)
    .values(values)
    .onConflictDoUpdate({ target: githubCredentials.id, set: { login: values.login, patEncrypted: values.patEncrypted, patLast4: values.patLast4, scopes: values.scopes, validatedAt: now, updatedAt: now } })
    .run();
}

export function toPublicGithubCredentials(db: Db, key: Buffer) {
  const credentials = getGithubCredentials(db, key);
  if (!credentials) {
    return null;
  }
  return { login: credentials.login, patLast4: credentials.patLast4, scopes: credentials.scopes };
}
```

Nota: `uuidv7` não é usado neste arquivo; não adicionar o import.

- [ ] **Step 3: Implementar `src/api/routes/settings-github.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { requireRole } from '../../auth/guards';
import { getGithubCredentials, saveGithubCredentials, testConnection, toPublicGithubCredentials } from '../../github/credentials';
import { audit } from '../../audit/audit';

const SaveBody = z.object({ pat: z.string().min(20).max(255) });
const TestBody = z.object({ pat: z.string().min(20).max(255).optional() });

export function registerGithubSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/settings/github', { preHandler: requireRole(deps, 'admin') }, async () => ({
    credentials: toPublicGithubCredentials(deps.db, deps.encryptionKey),
  }));

  app.put('/api/settings/github', { preHandler: requireRole(deps, 'admin') }, async (request) => {
    const body = SaveBody.parse(request.body);
    const result = await testConnection(body.pat);
    saveGithubCredentials(deps.db, deps.encryptionKey, { login: result.login, pat: body.pat, scopes: result.scopes });
    audit(deps.db, { userId: request.user?.id, action: 'github.credentials.save', targetType: 'github_credentials', targetId: 'singleton', data: { login: result.login }, ip: request.ip });
    return { credentials: toPublicGithubCredentials(deps.db, deps.encryptionKey) };
  });

  app.post('/api/settings/github/test', { preHandler: requireRole(deps, 'admin') }, async (request) => {
    const body = TestBody.parse(request.body ?? {});
    const pat = body.pat ?? getGithubCredentials(deps.db, deps.encryptionKey)?.pat;
    if (!pat) {
      throw new AppError('Nenhum token configurado', 'github_token_missing', 400);
    }
    const result = await testConnection(pat);
    return { ok: true, login: result.login, scopes: result.scopes };
  });
}
```

- [ ] **Step 4: Registrar em `src/api/app.ts` e escrever o teste**

Adicionar `registerGithubSettingsRoutes(app, deps);`.

`tests/integration/github-settings.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

function fakeGithub(login: string, status = 200, scopes = 'repo') {
  return vi.fn(async () =>
    new Response(JSON.stringify(status === 200 ? { login } : { message: 'Bad credentials' }), {
      status,
      headers: { 'content-type': 'application/json', 'x-oauth-scopes': scopes },
    }),
  ) as unknown as typeof fetch;
}

describe('credencial GitHub', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('salva credencial validada e mascara o token', async () => {
    vi.stubGlobal('fetch', fakeGithub('octocat'));
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const save = await app.inject({ method: 'PUT', url: '/api/settings/github', headers: { cookie }, payload: { pat: 'ghp_1234567890abcdefghij' } });
    expect(save.statusCode).toBe(200);
    expect(save.json().credentials).toEqual({ login: 'octocat', patLast4: 'ghij', scopes: 'repo' });
    expect(save.body).not.toContain('ghp_1234567890abcdefghij');
    await app.close();
  });

  it('rejeita token inválido', async () => {
    vi.stubGlobal('fetch', fakeGithub('', 401));
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const save = await app.inject({ method: 'PUT', url: '/api/settings/github', headers: { cookie }, payload: { pat: 'ghp_invalido_invalido_invalido' } });
    expect(save.statusCode).toBe(400);
    expect(save.json().error.code).toBe('invalid_github_token');
    await app.close();
  });

  it('testa usando o token salvo quando não enviado', async () => {
    vi.stubGlobal('fetch', fakeGithub('octocat'));
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await app.inject({ method: 'PUT', url: '/api/settings/github', headers: { cookie }, payload: { pat: 'ghp_1234567890abcdefghij' } });
    const test = await app.inject({ method: 'POST', url: '/api/settings/github/test', headers: { cookie }, payload: {} });
    expect(test.json()).toEqual({ ok: true, login: 'octocat', scopes: 'repo' });
    await app.close();
  });
});
```

- [ ] **Step 5: Rodar e verificar**

Run: `yarn test tests/integration/github-settings.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 10: Adaptadores de IA e perfis

**Files:**
- Create: `src/ai/adapters/types.ts`, `src/ai/adapters/openai-compatible.ts`, `src/ai/adapters/anthropic.ts`, `src/ai/adapters/index.ts`, `src/ai/profiles.ts`, `src/api/routes/ai-profiles.ts`
- Modify: `src/api/app.ts`
- Test: `tests/unit/adapters.test.ts`, `tests/integration/ai-profiles.test.ts`

**Interfaces:**
- Consumes: `Db`, `encryptSecret`, `decryptSecret`, `assertSafeUrl`, `AppError`.
- Produces: `ProviderKind`; `ProviderAdapter = { kind: ProviderKind; testConnection(input, fetchImpl?): Promise<{ ok: true }> }`; `getAdapter(kind): ProviderAdapter`; `ProfileInput` (zod) e tipos; `listProfiles(db, key)`, `getProfile(db, key, id)`, `createProfile(db, key, input)`, `updateProfile(db, key, id, input)`, `deleteProfile(db, id)`, `activateProfile(db, id)`, `testProfile(db, key, id, overridePat?)`, `getActiveProfile(db, key)`.

- [ ] **Step 1: Implementar `src/ai/adapters/types.ts`**

```ts
import type { AppError } from '../../api/errors';

export type ProviderKind = 'openai_compatible' | 'anthropic';

export type TestConnectionInput = { baseUrl: string; apiKey: string; model: string };

export type ProviderAdapter = {
  kind: ProviderKind;
  testConnection(input: TestConnectionInput, fetchImpl?: typeof fetch): Promise<{ ok: true }>;
};

export function excerpt(text: string, size = 200): string {
  return text.replace(/\s+/g, ' ').slice(0, size);
}

export type { AppError };
```

- [ ] **Step 2: Implementar `src/ai/adapters/openai-compatible.ts`**

```ts
import { AppError } from '../../api/errors';
import { excerpt, type ProviderAdapter } from './types';

function chatUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  kind: 'openai_compatible',
  async testConnection(input, fetchImpl) {
    const response = await (fetchImpl ?? fetch)(chatUrl(input.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({ model: input.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (!response.ok) {
      throw new AppError(`Provedor respondeu ${response.status}: ${excerpt(await response.text())}`, 'provider_test_failed', 400);
    }
    return { ok: true };
  },
};
```

- [ ] **Step 3: Implementar `src/ai/adapters/anthropic.ts`**

```ts
import { AppError } from '../../api/errors';
import { excerpt, type ProviderAdapter } from './types';

function messagesUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  return trimmed.endsWith('/v1') ? `${trimmed}/messages` : `${trimmed}/v1/messages`;
}

export const anthropicAdapter: ProviderAdapter = {
  kind: 'anthropic',
  async testConnection(input, fetchImpl) {
    const response = await (fetchImpl ?? fetch)(messagesUrl(input.baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': input.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: input.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (!response.ok) {
      throw new AppError(`Provedor respondeu ${response.status}: ${excerpt(await response.text())}`, 'provider_test_failed', 400);
    }
    return { ok: true };
  },
};
```

- [ ] **Step 4: Implementar `src/ai/adapters/index.ts`**

```ts
import { anthropicAdapter } from './anthropic';
import { openAiCompatibleAdapter } from './openai-compatible';
import type { ProviderAdapter, ProviderKind } from './types';

const adapters: Record<ProviderKind, ProviderAdapter> = {
  openai_compatible: openAiCompatibleAdapter,
  anthropic: anthropicAdapter,
};

export function getAdapter(kind: ProviderKind): ProviderAdapter {
  return adapters[kind];
}
```

- [ ] **Step 5: Implementar `src/ai/profiles.ts`**

```ts
import { eq, ne } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import type { Db } from '../db/client';
import { aiProfileSkills, aiProfiles, skills } from '../db/schema';
import { decryptSecret, encryptSecret } from '../auth/crypto';
import { AppError } from '../api/errors';
import { assertSafeUrl } from '../shared/url-guard';
import { getAdapter } from './adapters';
import type { ProviderKind } from './adapters/types';

const MAX_PROMPT_TOTAL = 131072;

export const ProfileInput = z.object({
  name: z.string().min(1).max(80),
  provider: z.enum(['openai_compatible', 'anthropic']),
  baseUrl: z.string().url(),
  model: z.string().min(1).max(200),
  apiKey: z.string().min(1).max(500).optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  maxOutputTokens: z.number().int().min(1).max(32000).default(4096),
  maxTurns: z.number().int().min(1).max(50).default(20),
  maxTotalTokens: z.number().int().min(1000).max(1000000).default(200000),
  maxDurationSec: z.number().int().min(60).max(3600).default(600),
  maxFindings: z.number().int().min(1).max(50).default(25),
  maxGithubCalls: z.number().int().min(1).max(500).default(80),
  prePrompt: z.string().max(16384).default(''),
  skillIds: z.array(z.string().min(1)).max(20).default([]),
});

export type ProfileInputType = z.infer<typeof ProfileInput>;

type ProfileRow = typeof aiProfiles.$inferSelect;

export type PublicProfile = Omit<ProfileRow, 'apiKeyEncrypted'> & { hasApiKey: boolean; skillIds: string[] };

export function toPublicProfile(db: Db, row: ProfileRow): PublicProfile {
  const { apiKeyEncrypted: _ignored, ...rest } = row;
  const linked = db.select().from(aiProfileSkills).where(eq(aiProfileSkills.profileId, row.id)).all();
  return {
    ...rest,
    hasApiKey: row.apiKeyEncrypted.length > 0,
    skillIds: linked.sort((a, b) => a.position - b.position).map((item) => item.skillId),
  };
}

export function listProfiles(db: Db): PublicProfile[] {
  return db.select().from(aiProfiles).all().map((row) => toPublicProfile(db, row));
}

export function getProfileRow(db: Db, id: string): ProfileRow {
  const row = db.select().from(aiProfiles).where(eq(aiProfiles.id, id)).get();
  if (!row) {
    throw new AppError('Perfil não encontrado', 'profile_not_found', 404);
  }
  return row;
}

function validateSkillSelection(db: Db, input: ProfileInputType): void {
  let total = input.prePrompt.length;
  for (const skillId of input.skillIds) {
    const skill = db.select().from(skills).where(eq(skills.id, skillId)).get();
    if (!skill) {
      throw new AppError(`Skill não encontrada: ${skillId}`, 'skill_not_found', 400);
    }
    total += skill.contentMd.length;
  }
  if (total > MAX_PROMPT_TOTAL) {
    throw new AppError('Pré-prompt e skills excedem o limite total de 128 KB', 'prompt_too_large', 400);
  }
}

function setSkillLinks(db: Db, profileId: string, skillIds: string[]): void {
  db.delete(aiProfileSkills).where(eq(aiProfileSkills.profileId, profileId)).run();
  skillIds.forEach((skillId, index) => {
    db.insert(aiProfileSkills).values({ profileId, skillId, position: index }).run();
  });
}

export function createProfile(db: Db, encryptionKey: Buffer, input: ProfileInputType): PublicProfile {
  validateSkillSelection(db, input);
  if (!input.apiKey) {
    throw new AppError('Chave de API é obrigatória', 'api_key_required', 400);
  }
  const existing = db.select().from(aiProfiles).where(eq(aiProfiles.name, input.name)).get();
  if (existing) {
    throw new AppError('Já existe um perfil com esse nome', 'profile_name_taken', 409);
  }
  const now = Date.now();
  const id = uuidv7();
  db.transaction((tx) => {
    tx.insert(aiProfiles)
      .values({
        id,
        name: input.name,
        provider: input.provider,
        baseUrl: input.baseUrl,
        model: input.model,
        apiKeyEncrypted: encryptSecret(encryptionKey, input.apiKey!),
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        maxTurns: input.maxTurns,
        maxTotalTokens: input.maxTotalTokens,
        maxDurationSec: input.maxDurationSec,
        maxFindings: input.maxFindings,
        maxGithubCalls: input.maxGithubCalls,
        prePrompt: input.prePrompt,
        isActive: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  });
  setSkillLinks(db, id, input.skillIds);
  return toPublicProfile(db, getProfileRow(db, id));
}

export function updateProfile(db: Db, encryptionKey: Buffer, id: string, input: ProfileInputType): PublicProfile {
  const row = getProfileRow(db, id);
  validateSkillSelection(db, input);
  const duplicate = db.select().from(aiProfiles).where(eq(aiProfiles.name, input.name)).all().find((item) => item.id !== id);
  if (duplicate) {
    throw new AppError('Já existe um perfil com esse nome', 'profile_name_taken', 409);
  }
  const apiKeyEncrypted = input.apiKey ? encryptSecret(encryptionKey, input.apiKey) : row.apiKeyEncrypted;
  db.update(aiProfiles)
    .set({
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKeyEncrypted,
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      maxTurns: input.maxTurns,
      maxTotalTokens: input.maxTotalTokens,
      maxDurationSec: input.maxDurationSec,
      maxFindings: input.maxFindings,
      maxGithubCalls: input.maxGithubCalls,
      prePrompt: input.prePrompt,
      updatedAt: Date.now(),
    })
    .where(eq(aiProfiles.id, id))
    .run();
  setSkillLinks(db, id, input.skillIds);
  return toPublicProfile(db, getProfileRow(db, id));
}

export function deleteProfile(db: Db, id: string): void {
  const row = getProfileRow(db, id);
  if (row.isActive) {
    throw new AppError('Não é possível remover o perfil ativo', 'active_profile', 409);
  }
  db.delete(aiProfiles).where(eq(aiProfiles.id, id)).run();
}

export function activateProfile(db: Db, id: string): void {
  getProfileRow(db, id);
  db.transaction((tx) => {
    tx.update(aiProfiles).set({ isActive: false, updatedAt: Date.now() }).where(ne(aiProfiles.id, id)).run();
    tx.update(aiProfiles).set({ isActive: true, updatedAt: Date.now() }).where(eq(aiProfiles.id, id)).run();
  });
}

export async function testProfile(db: Db, encryptionKey: Buffer, id: string, overrideApiKey?: string, fetchImpl?: typeof fetch): Promise<{ ok: true }> {
  const row = getProfileRow(db, id);
  const apiKey = overrideApiKey ?? decryptSecret(encryptionKey, row.apiKeyEncrypted);
  await assertSafeUrl(row.baseUrl, { allowPrivate: true });
  return getAdapter(row.provider as ProviderKind).testConnection({ baseUrl: row.baseUrl, apiKey, model: row.model }, fetchImpl);
}

export function getActiveProfile(db: Db, encryptionKey: Buffer): (ProfileRow & { apiKey: string }) | undefined {
  const row = db.select().from(aiProfiles).where(eq(aiProfiles.isActive, true)).get();
  if (!row) {
    return undefined;
  }
  return { ...row, apiKey: decryptSecret(encryptionKey, row.apiKeyEncrypted) };
}
```

Nota: `testProfile` usa `allowPrivate: true` porque provedores locais (Ollama, LM Studio) são um caso de uso legítimo e o admin é quem configura; a validação de URL ainda rejeita esquemas não http. O Plano 2 reutiliza `assertSafeUrl` com `ALLOW_PRIVATE_URLS` nas chamadas de review.

- [ ] **Step 6: Implementar `src/api/routes/ai-profiles.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireRole } from '../../auth/guards';
import { ProfileInput, activateProfile, createProfile, deleteProfile, getProfileRow, listProfiles, testProfile, toPublicProfile, updateProfile } from '../../ai/profiles';
import { audit } from '../../audit/audit';

const IdParam = z.object({ id: z.string().min(1) });
const TestBody = z.object({ apiKey: z.string().min(1).max(500).optional() });

export function registerAiProfileRoutes(app: FastifyInstance, deps: AppDeps): void {
  const admin = requireRole(deps, 'admin');

  app.get('/api/ai-profiles', { preHandler: admin }, async () => ({ profiles: listProfiles(deps.db) }));

  app.post('/api/ai-profiles', { preHandler: admin }, async (request, reply) => {
    const input = ProfileInput.parse(request.body);
    const profile = createProfile(deps.db, deps.encryptionKey, input);
    audit(deps.db, { userId: request.user?.id, action: 'ai_profile.create', targetType: 'ai_profile', targetId: profile.id, data: { name: profile.name }, ip: request.ip });
    return reply.code(201).send({ profile });
  });

  app.get('/api/ai-profiles/:id', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    return { profile: toPublicProfile(deps.db, getProfileRow(deps.db, id)) };
  });

  app.put('/api/ai-profiles/:id', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const input = ProfileInput.parse(request.body);
    const profile = updateProfile(deps.db, deps.encryptionKey, id, input);
    audit(deps.db, { userId: request.user?.id, action: 'ai_profile.update', targetType: 'ai_profile', targetId: id, ip: request.ip });
    return { profile };
  });

  app.delete('/api/ai-profiles/:id', { preHandler: admin }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    deleteProfile(deps.db, id);
    audit(deps.db, { userId: request.user?.id, action: 'ai_profile.delete', targetType: 'ai_profile', targetId: id, ip: request.ip });
    return reply.code(204).send();
  });

  app.post('/api/ai-profiles/:id/activate', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    activateProfile(deps.db, id);
    audit(deps.db, { userId: request.user?.id, action: 'ai_profile.activate', targetType: 'ai_profile', targetId: id, ip: request.ip });
    return { profile: toPublicProfile(deps.db, getProfileRow(deps.db, id)) };
  });

  app.post('/api/ai-profiles/:id/test', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const body = TestBody.parse(request.body ?? {});
    await testProfile(deps.db, deps.encryptionKey, id, body.apiKey);
    return { ok: true };
  });
}
```

- [ ] **Step 7: Registrar em `src/api/app.ts` e escrever os testes**

Adicionar `registerAiProfileRoutes(app, deps);`.

`tests/unit/adapters.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { getAdapter } from '../../src/ai/adapters';

const input = { baseUrl: 'https://provedor.exemplo.com/v1', apiKey: 'k', model: 'm' };

describe('adaptadores', () => {
  it('openai-compatible monta a URL e o corpo corretos', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await getAdapter('openai_compatible').testConnection(input, fetchImpl);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://provedor.exemplo.com/v1/chat/completions');
    expect(JSON.parse(String(init.body)).max_tokens).toBe(1);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('anthropic monta a URL e os cabeçalhos corretos', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await getAdapter('anthropic').testConnection({ ...input, baseUrl: 'https://api.anthropic.com' }, fetchImpl);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
  });

  it('propaga erro do provedor com status', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"nope"}', { status: 401 })) as unknown as typeof fetch;
    await expect(getAdapter('openai_compatible').testConnection(input, fetchImpl)).rejects.toThrow(/401/);
  });
});
```

`tests/integration/ai-profiles.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

const profileBody = {
  name: 'principal',
  provider: 'openai_compatible',
  baseUrl: 'https://provedor.exemplo.com/v1',
  model: 'modelo-x',
  apiKey: 'chave-secreta-123',
  skillIds: [],
};

describe('perfis de IA', () => {
  it('cria, mascara a chave, ativa e testa', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: profileBody });
    expect(created.statusCode).toBe(201);
    expect(created.json().profile.hasApiKey).toBe(true);
    expect(created.body).not.toContain('chave-secreta-123');
    const id = created.json().profile.id;

    const activated = await app.inject({ method: 'POST', url: `/api/ai-profiles/${id}/activate`, headers: { cookie } });
    expect(activated.json().profile.isActive).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const tested = await app.inject({ method: 'POST', url: `/api/ai-profiles/${id}/test`, headers: { cookie }, payload: {} });
    expect(tested.json()).toEqual({ ok: true });
    vi.unstubAllGlobals();
    await app.close();
  });

  it('mantém a chave quando o update não envia apiKey', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: profileBody });
    const id = created.json().profile.id;
    const updated = await app.inject({ method: 'PUT', url: `/api/ai-profiles/${id}`, headers: { cookie }, payload: { ...profileBody, name: 'renomeado', apiKey: undefined } });
    expect(updated.json().profile.name).toBe('renomeado');
    expect(updated.json().profile.hasApiKey).toBe(true);
    await app.close();
  });

  it('não remove o perfil ativo', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: profileBody });
    const id = created.json().profile.id;
    await app.inject({ method: 'POST', url: `/api/ai-profiles/${id}/activate`, headers: { cookie } });
    const removed = await app.inject({ method: 'DELETE', url: `/api/ai-profiles/${id}`, headers: { cookie } });
    expect(removed.statusCode).toBe(409);
    await app.close();
  });

  it('valida limites', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const response = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: { ...profileBody, temperature: 5 } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
```

- [ ] **Step 8: Rodar e verificar**

Run: `yarn test tests/unit/adapters.test.ts tests/integration/ai-profiles.test.ts`
Expected: PASS.

- [ ] **Step 9: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 11: Skills

**Files:**
- Create: `src/api/routes/skills.ts`
- Modify: `src/api/app.ts`
- Test: `tests/integration/skills.test.ts`

**Interfaces:**
- Consumes: `Db`, guards, `AppError`.
- Produces: `registerSkillRoutes(app, deps)`.

- [ ] **Step 1: Implementar `src/api/routes/skills.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { skills } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { audit } from '../../audit/audit';

const SkillBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(512).default(''),
  contentMd: z.string().min(1).max(32768),
});

const IdParam = z.object({ id: z.string().min(1) });

export function registerSkillRoutes(app: FastifyInstance, deps: AppDeps): void {
  const admin = requireRole(deps, 'admin');

  app.get('/api/skills', { preHandler: admin }, async () => ({ skills: deps.db.select().from(skills).all() }));

  app.post('/api/skills', { preHandler: admin }, async (request, reply) => {
    const body = SkillBody.parse(request.body);
    const existing = deps.db.select().from(skills).where(eq(skills.name, body.name)).get();
    if (existing) {
      throw new AppError('Já existe uma skill com esse nome', 'skill_name_taken', 409);
    }
    const now = Date.now();
    const id = uuidv7();
    deps.db.insert(skills).values({ id, name: body.name, description: body.description, contentMd: body.contentMd, createdAt: now, updatedAt: now }).run();
    audit(deps.db, { userId: request.user?.id, action: 'skill.create', targetType: 'skill', targetId: id, ip: request.ip });
    return reply.code(201).send({ skill: deps.db.select().from(skills).where(eq(skills.id, id)).get() });
  });

  app.get('/api/skills/:id', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const skill = deps.db.select().from(skills).where(eq(skills.id, id)).get();
    if (!skill) {
      throw new AppError('Skill não encontrada', 'skill_not_found', 404);
    }
    return { skill };
  });

  app.put('/api/skills/:id', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const body = SkillBody.parse(request.body);
    const skill = deps.db.select().from(skills).where(eq(skills.id, id)).get();
    if (!skill) {
      throw new AppError('Skill não encontrada', 'skill_not_found', 404);
    }
    const duplicate = deps.db.select().from(skills).where(eq(skills.name, body.name)).all().find((item) => item.id !== id);
    if (duplicate) {
      throw new AppError('Já existe uma skill com esse nome', 'skill_name_taken', 409);
    }
    deps.db.update(skills).set({ name: body.name, description: body.description, contentMd: body.contentMd, updatedAt: Date.now() }).where(eq(skills.id, id)).run();
    audit(deps.db, { userId: request.user?.id, action: 'skill.update', targetType: 'skill', targetId: id, ip: request.ip });
    return { skill: deps.db.select().from(skills).where(eq(skills.id, id)).get() };
  });

  app.delete('/api/skills/:id', { preHandler: admin }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    const skill = deps.db.select().from(skills).where(eq(skills.id, id)).get();
    if (!skill) {
      throw new AppError('Skill não encontrada', 'skill_not_found', 404);
    }
    deps.db.delete(skills).where(eq(skills.id, id)).run();
    audit(deps.db, { userId: request.user?.id, action: 'skill.delete', targetType: 'skill', targetId: id, ip: request.ip });
    return reply.code(204).send();
  });
}
```

- [ ] **Step 2: Registrar em `src/api/app.ts` e escrever o teste**

Adicionar `registerSkillRoutes(app, deps);`.

`tests/integration/skills.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

const skillBody = { name: 'security-audit', description: 'Foco em segurança', contentMd: 'Verifique injeção, autorização e segredos.' };

describe('skills', () => {
  it('cria, edita, lista e remove', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: skillBody });
    expect(created.statusCode).toBe(201);
    const id = created.json().skill.id;
    const updated = await app.inject({ method: 'PUT', url: `/api/skills/${id}`, headers: { cookie }, payload: { ...skillBody, contentMd: 'Outro conteúdo.' } });
    expect(updated.json().skill.contentMd).toBe('Outro conteúdo.');
    const list = await app.inject({ method: 'GET', url: '/api/skills', headers: { cookie } });
    expect(list.json().skills).toHaveLength(1);
    const removed = await app.inject({ method: 'DELETE', url: `/api/skills/${id}`, headers: { cookie } });
    expect(removed.statusCode).toBe(204);
    await app.close();
  });

  it('rejeita nome duplicado', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: skillBody });
    const duplicate = await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: skillBody });
    expect(duplicate.statusCode).toBe(409);
    await app.close();
  });

  it('associa skills a um perfil na ordem enviada', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const first = await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: { ...skillBody, name: 's1' } });
    const second = await app.inject({ method: 'POST', url: '/api/skills', headers: { cookie }, payload: { ...skillBody, name: 's2' } });
    const profile = await app.inject({
      method: 'POST',
      url: '/api/ai-profiles',
      headers: { cookie },
      payload: {
        name: 'p1',
        provider: 'openai_compatible',
        baseUrl: 'https://provedor.exemplo.com/v1',
        model: 'm',
        apiKey: 'k',
        skillIds: [second.json().skill.id, first.json().skill.id],
      },
    });
    expect(profile.json().profile.skillIds).toEqual([second.json().skill.id, first.json().skill.id]);
    await app.close();
  });

  it('rejeita skill inexistente no perfil', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai-profiles',
      headers: { cookie },
      payload: { name: 'p1', provider: 'openai_compatible', baseUrl: 'https://provedor.exemplo.com/v1', model: 'm', apiKey: 'k', skillIds: ['inexistente'] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('skill_not_found');
    await app.close();
  });
});
```

- [ ] **Step 3: Rodar e verificar**

Run: `yarn test tests/integration/skills.test.ts`
Expected: PASS.

- [ ] **Step 4: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

### Task 12: Webhooks de saída

**Files:**
- Create: `src/webhooks/sign.ts`, `src/webhooks/dispatcher.ts`, `src/api/routes/webhooks.ts`
- Modify: `src/api/app.ts`
- Test: `tests/unit/webhook-sign.test.ts`, `tests/integration/webhooks.test.ts`

**Interfaces:**
- Consumes: `Db`, `encryptSecret`, `decryptSecret`, `assertSafeUrl`, guards.
- Produces: `signPayload(secret, body): string`; `WEBHOOK_EVENTS`; `WebhookEvent`; `dispatchToWebhook(deps, webhook, event, payload): Promise<boolean>`; `dispatchEvent(deps, event, payload): Promise<void>`; `registerWebhookRoutes(app, deps)`.

- [ ] **Step 1: Implementar `src/webhooks/sign.ts` e o teste unitário**

`src/webhooks/sign.ts`:

```ts
import { createHmac } from 'node:crypto';

export function signPayload(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}
```

`tests/unit/webhook-sign.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signPayload } from '../../src/webhooks/sign';

describe('signPayload', () => {
  it('gera HMAC-SHA256 estável', () => {
    const expected = createHmac('sha256', 'segredo').update('{"a":1}').digest('hex');
    expect(signPayload('segredo', '{"a":1}')).toBe(expected);
  });

  it('muda com o segredo', () => {
    expect(signPayload('a', 'x')).not.toBe(signPayload('b', 'x'));
  });
});
```

- [ ] **Step 2: Implementar `src/webhooks/dispatcher.ts`**

```ts
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { webhookDeliveries, webhooks } from '../db/schema';
import { decryptSecret } from '../auth/crypto';
import { assertSafeUrl } from '../shared/url-guard';
import { signPayload } from './sign';

export const WEBHOOK_EVENTS = ['review.published', 'job.failed', 'job.partial', 'poller.paused', 'webhook.test'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export type WebhookRow = typeof webhooks.$inferSelect;

export type DispatchDeps = {
  db: Db;
  encryptionKey: Buffer;
  allowPrivate: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const RETRY_DELAYS = [0, 1000, 5000];

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function record(deps: DispatchDeps, webhookId: string, event: string, attempt: number, success: boolean, statusCode: number | null, responseExcerpt: string): void {
  deps.db.insert(webhookDeliveries)
    .values({ id: uuidv7(), webhookId, event, success, statusCode, attempt, responseExcerpt: responseExcerpt.slice(0, 512), createdAt: Date.now() })
    .run();
}

export async function dispatchToWebhook(deps: DispatchDeps, webhook: WebhookRow, event: WebhookEvent, payload: unknown): Promise<boolean> {
  const secret = decryptSecret(deps.encryptionKey, webhook.secretEncrypted);
  const body = JSON.stringify({ event, timestamp: Date.now(), data: payload });
  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    const delay = RETRY_DELAYS[attempt]!;
    if (delay > 0) {
      await (deps.sleep ?? defaultSleep)(delay);
    }
    try {
      let currentUrl = webhook.url;
      let response: Response | undefined;
      for (let hop = 0; hop <= 3; hop += 1) {
        await assertSafeUrl(currentUrl, { allowPrivate: deps.allowPrivate });
        response = await (deps.fetchImpl ?? fetch)(currentUrl, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'content-type': 'application/json',
            'x-prreviewer-event': event,
            'x-prreviewer-signature': `sha256=${signPayload(secret, body)}`,
          },
          body,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || hop === 3) {
            throw new Error('Redirecionamento inválido');
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }
        break;
      }
      if (!response) {
        throw new Error('Sem resposta do webhook');
      }
      const excerpt = (await response.text()).slice(0, 512);
      record(deps, webhook.id, event, attempt + 1, response.ok, response.status, excerpt);
      if (response.ok) {
        return true;
      }
    } catch (error) {
      record(deps, webhook.id, event, attempt + 1, false, null, error instanceof Error ? error.message : 'erro desconhecido');
    }
  }
  return false;
}

export async function dispatchEvent(deps: DispatchDeps, event: WebhookEvent, payload: unknown): Promise<void> {
  const rows = deps.db.select().from(webhooks).where(eq(webhooks.enabled, true)).all();
  const interested = rows.filter((row) => (JSON.parse(row.eventsJson) as string[]).includes(event));
  for (const row of interested) {
    await dispatchToWebhook(deps, row, event, payload);
  }
}
```

- [ ] **Step 3: Implementar `src/api/routes/webhooks.ts`**

```ts
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { webhookDeliveries, webhooks } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { audit } from '../../audit/audit';
import { assertSafeUrl } from '../../shared/url-guard';
import { WEBHOOK_EVENTS, dispatchToWebhook, type WebhookEvent } from '../../webhooks/dispatcher';
import { encryptSecret } from '../../auth/crypto';

const CreateBody = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  secret: z.string().min(16).max(200).optional(),
  enabled: z.boolean().default(true),
});

const UpdateBody = CreateBody.partial();

const IdParam = z.object({ id: z.string().min(1) });

function toPublic(row: typeof webhooks.$inferSelect) {
  return { id: row.id, url: row.url, events: JSON.parse(row.eventsJson) as string[], enabled: row.enabled, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function registerWebhookRoutes(app: FastifyInstance, deps: AppDeps): void {
  const admin = requireRole(deps, 'admin');

  app.get('/api/webhooks', { preHandler: admin }, async () => ({
    webhooks: deps.db.select().from(webhooks).all().map(toPublic),
  }));

  app.post('/api/webhooks', { preHandler: admin }, async (request, reply) => {
    const body = CreateBody.parse(request.body);
    await assertSafeUrl(body.url, { allowPrivate: deps.config.ALLOW_PRIVATE_URLS });
    const secret = body.secret ?? randomBytes(32).toString('base64url');
    const now = Date.now();
    const id = uuidv7();
    deps.db.insert(webhooks)
      .values({ id, url: body.url, secretEncrypted: encryptSecret(deps.encryptionKey, secret), eventsJson: JSON.stringify(body.events), enabled: body.enabled, createdAt: now, updatedAt: now })
      .run();
    audit(deps.db, { userId: request.user?.id, action: 'webhook.create', targetType: 'webhook', targetId: id, data: { url: body.url }, ip: request.ip });
    return reply.code(201).send({ webhook: toPublic(deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get()!), secret });
  });

  app.patch('/api/webhooks/:id', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const body = UpdateBody.parse(request.body);
    const row = deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!row) {
      throw new AppError('Webhook não encontrado', 'webhook_not_found', 404);
    }
    if (body.url) {
      await assertSafeUrl(body.url, { allowPrivate: deps.config.ALLOW_PRIVATE_URLS });
    }
    deps.db.update(webhooks)
      .set({
        url: body.url ?? row.url,
        eventsJson: body.events ? JSON.stringify(body.events) : row.eventsJson,
        enabled: body.enabled ?? row.enabled,
        secretEncrypted: body.secret ? encryptSecret(deps.encryptionKey, body.secret) : row.secretEncrypted,
        updatedAt: Date.now(),
      })
      .where(eq(webhooks.id, id))
      .run();
    audit(deps.db, { userId: request.user?.id, action: 'webhook.update', targetType: 'webhook', targetId: id, ip: request.ip });
    return { webhook: toPublic(deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get()!) };
  });

  app.delete('/api/webhooks/:id', { preHandler: admin }, async (request, reply) => {
    const { id } = IdParam.parse(request.params);
    const row = deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!row) {
      throw new AppError('Webhook não encontrado', 'webhook_not_found', 404);
    }
    deps.db.delete(webhooks).where(eq(webhooks.id, id)).run();
    audit(deps.db, { userId: request.user?.id, action: 'webhook.delete', targetType: 'webhook', targetId: id, ip: request.ip });
    return reply.code(204).send();
  });

  app.post('/api/webhooks/:id/test', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const row = deps.db.select().from(webhooks).where(eq(webhooks.id, id)).get();
    if (!row) {
      throw new AppError('Webhook não encontrado', 'webhook_not_found', 404);
    }
    const ok = await dispatchToWebhook({ db: deps.db, encryptionKey: deps.encryptionKey, allowPrivate: deps.config.ALLOW_PRIVATE_URLS }, row, 'webhook.test' as WebhookEvent, { message: 'entrega de teste' });
    return { ok };
  });

  app.get('/api/webhooks/:id/deliveries', { preHandler: admin }, async (request) => {
    const { id } = IdParam.parse(request.params);
    const deliveries = deps.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id)).orderBy(desc(webhookDeliveries.createdAt)).limit(50).all();
    return { deliveries };
  });
}
```

- [ ] **Step 4: Registrar em `src/api/app.ts` e escrever o teste**

Adicionar `registerWebhookRoutes(app, deps);`.

`tests/integration/webhooks.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

const webhookBody = { url: 'https://93.184.216.34/hook', events: ['job.failed', 'webhook.test'] };

describe('webhooks', () => {
  it('cria com secret, testa entrega e lista entregas', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', headers: { cookie }, payload: webhookBody });
    expect(created.statusCode).toBe(201);
    expect(typeof created.json().secret).toBe('string');
    const id = created.json().webhook.id;

    const tested = await app.inject({ method: 'POST', url: `/api/webhooks/${id}/test`, headers: { cookie } });
    expect(tested.json().ok).toBe(true);
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const headers = calls[0]![1].headers as Record<string, string>;
    expect(headers['x-prreviewer-event']).toBe('webhook.test');
    expect(headers['x-prreviewer-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    const deliveries = await app.inject({ method: 'GET', url: `/api/webhooks/${id}/deliveries`, headers: { cookie } });
    expect(deliveries.json().deliveries).toHaveLength(1);
    expect(deliveries.json().deliveries[0].success).toBe(true);
    vi.unstubAllGlobals();
    await app.close();
  });

  it('bloqueia URL privada por padrão', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', headers: { cookie }, payload: { ...webhookBody, url: 'http://127.0.0.1:9000/hook' } });
    expect(created.statusCode).toBe(400);
    await app.close();
  });

  it('tenta novamente em falha e registra tentativas', async () => {
    const fetchImpl = vi.fn(async () => new Response('erro', { status: 500 }));
    vi.stubGlobal('fetch', fetchImpl);
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', headers: { cookie }, payload: webhookBody });
    const id = created.json().webhook.id;
    const tested = await app.inject({ method: 'POST', url: `/api/webhooks/${id}/test`, headers: { cookie } });
    expect(tested.json().ok).toBe(false);
    const deliveries = await app.inject({ method: 'GET', url: `/api/webhooks/${id}/deliveries`, headers: { cookie } });
    expect(deliveries.json().deliveries).toHaveLength(3);
    expect(deliveries.json().deliveries.every((d: { success: boolean }) => d.success === false)).toBe(true);
    vi.unstubAllGlobals();
    await app.close();
  });
});
```

Nota: as tentativas usam espera real de 1 s + 5 s no último caso; o teste aceita ~6 s de duração. Para acelerar, o helper de teste pode passar `sleep: async () => {}` ao dispatcher em um teste unitário do dispatcher; aqui mantemos o comportamento real.

- [ ] **Step 5: Rodar e verificar**

Run: `yarn test tests/unit/webhook-sign.test.ts tests/integration/webhooks.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 13: Repositórios, fila (somente leitura), configurações do sistema, dashboard e SSE

**Files:**
- Create: `src/events/bus.ts`, `src/api/routes/repositories.ts`, `src/api/routes/jobs-read.ts`, `src/api/routes/queue.ts`, `src/api/routes/settings-system.ts`, `src/api/routes/dashboard.ts`, `src/api/routes/events.ts`
- Modify: `src/api/app.ts` (adicionar `bus` a `AppDeps` e registrar rotas)
- Modify: `tests/helpers/app.ts`
- Test: `tests/unit/bus.test.ts`, `tests/integration/events.test.ts`, `tests/integration/dashboard.test.ts`

**Interfaces:**
- Consumes: `Db`, `getSetting`, `setSetting`, guards.
- Produces: `createEventBus(): EventBus` com `publish(event: BusEvent)` e `subscribe(listener): () => void`; `AppDeps` ganha `bus: EventBus`; rotas `GET /api/repositories`, `PATCH /api/repositories/:id`, `GET /api/jobs`, `GET /api/reviews`, `GET /api/queue`, `POST /api/queue/pause`, `POST /api/queue/resume`, `GET/PUT /api/settings/system`, `GET /api/dashboard`, `GET /api/events`.

- [ ] **Step 1: Implementar `src/events/bus.ts` e o teste unitário**

```ts
export type BusEvent = { type: string; data: unknown; at: number };

export type EventBus = {
  publish(event: BusEvent): void;
  subscribe(listener: (event: BusEvent) => void): () => void;
};

export function createEventBus(): EventBus {
  const listeners = new Set<(event: BusEvent) => void>();
  return {
    publish(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
```

`tests/unit/bus.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createEventBus } from '../../src/events/bus';

describe('EventBus', () => {
  it('entrega eventos e respeita unsubscribe', () => {
    const bus = createEventBus();
    const received: string[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event.type));
    bus.publish({ type: 'a', data: null, at: 1 });
    unsubscribe();
    bus.publish({ type: 'b', data: null, at: 2 });
    expect(received).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Implementar as rotas**

`src/api/routes/repositories.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { repositories } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { audit } from '../../audit/audit';

export function registerRepositoryRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/repositories', { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') }, async () => ({
    repositories: deps.db.select().from(repositories).all(),
  }));

  app.patch('/api/repositories/:id', { preHandler: requireRole(deps, 'admin') }, async (request) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    const row = deps.db.select().from(repositories).where(eq(repositories.id, id)).get();
    if (!row) {
      throw new AppError('Repositório não encontrado', 'repository_not_found', 404);
    }
    deps.db.update(repositories).set({ enabled, updatedAt: Date.now() }).where(eq(repositories.id, id)).run();
    audit(deps.db, { userId: request.user?.id, action: 'repository.update', targetType: 'repository', targetId: id, data: { enabled }, ip: request.ip });
    return { repository: deps.db.select().from(repositories).where(eq(repositories.id, id)).get() };
  });
}
```

`src/api/routes/jobs-read.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { jobs, reviews } from '../../db/schema';
import { requireRole } from '../../auth/guards';

const ListQuery = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled']).optional(),
  repositoryId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function paginate(query: { page: number; limit: number }) {
  return { offset: (query.page - 1) * query.limit, limit: query.limit };
}

export function registerJobReadRoutes(app: FastifyInstance, deps: AppDeps): void {
  const viewer = requireRole(deps, 'viewer', 'operator', 'admin');

  app.get('/api/jobs', { preHandler: viewer }, async (request) => {
    const query = ListQuery.parse(request.query);
    const filters: SQL[] = [];
    if (query.status) {
      filters.push(eq(jobs.status, query.status));
    }
    if (query.repositoryId) {
      filters.push(eq(jobs.repositoryId, query.repositoryId));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const { offset, limit } = paginate(query);
    const rows = deps.db.select().from(jobs).where(where).orderBy(desc(jobs.queuedAt)).limit(limit).offset(offset).all();
    const total = deps.db.select({ value: count() }).from(jobs).where(where).get()?.value ?? 0;
    return { jobs: rows, total, page: query.page, limit: query.limit };
  });

  app.get('/api/reviews', { preHandler: viewer }, async (request) => {
    const query = ListQuery.pick({ page: true, limit: true }).parse(request.query);
    const { offset, limit } = paginate(query);
    const rows = deps.db.select().from(reviews).orderBy(desc(reviews.postedAt)).limit(limit).offset(offset).all();
    const total = deps.db.select({ value: count() }).from(reviews).get()?.value ?? 0;
    return { reviews: rows, total, page: query.page, limit: query.limit };
  });
}
```

`src/api/routes/queue.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import type { AppDeps } from '../app';
import { jobs } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { getSetting, setSetting } from '../../db/settings';
import { audit } from '../../audit/audit';

const QUEUE_PAUSED_KEY = 'queue_paused';

export function isQueuePaused(db: AppDeps['db']): boolean {
  return getSetting<boolean>(db, QUEUE_PAUSED_KEY) === true;
}

export function registerQueueRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/queue', { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') }, async () => ({
    queued: deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'queued')).get()?.value ?? 0,
    running: deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'running')).get()?.value ?? 0,
    paused: isQueuePaused(deps.db),
  }));

  app.post('/api/queue/pause', { preHandler: requireRole(deps, 'operator', 'admin') }, async (request) => {
    setSetting(deps.db, QUEUE_PAUSED_KEY, true);
    audit(deps.db, { userId: request.user?.id, action: 'queue.pause', ip: request.ip });
    deps.bus.publish({ type: 'queue.updated', data: { paused: true }, at: Date.now() });
    return { paused: true };
  });

  app.post('/api/queue/resume', { preHandler: requireRole(deps, 'operator', 'admin') }, async (request) => {
    setSetting(deps.db, QUEUE_PAUSED_KEY, false);
    audit(deps.db, { userId: request.user?.id, action: 'queue.resume', ip: request.ip });
    deps.bus.publish({ type: 'queue.updated', data: { paused: false }, at: Date.now() });
    return { paused: false };
  });
}
```

`src/api/routes/settings-system.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireRole } from '../../auth/guards';
import { getSetting, setSetting } from '../../db/settings';
import { audit } from '../../audit/audit';

const SYSTEM_KEY = 'system';

export const SystemSettings = z.object({
  pollingIntervalSec: z.number().int().min(30).max(3600).default(60),
  retentionDays: z.number().int().min(1).max(3650).default(90),
  concurrency: z.number().int().min(1).max(3).default(1),
  ignoreDrafts: z.boolean().default(false),
  skipOwnPrs: z.boolean().default(true),
});

export type SystemSettingsType = z.infer<typeof SystemSettings>;

export function getSystemSettings(db: AppDeps['db']): SystemSettingsType {
  return SystemSettings.parse(getSetting<Partial<SystemSettingsType>>(db, SYSTEM_KEY) ?? {});
}

export function registerSystemSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const admin = requireRole(deps, 'admin');

  app.get('/api/settings/system', { preHandler: admin }, async () => ({ settings: getSystemSettings(deps.db) }));

  app.put('/api/settings/system', { preHandler: admin }, async (request) => {
    const body = SystemSettings.parse(request.body);
    setSetting(deps.db, SYSTEM_KEY, body);
    audit(deps.db, { userId: request.user?.id, action: 'system_settings.update', data: body, ip: request.ip });
    return { settings: body };
  });
}
```

`src/api/routes/dashboard.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { count, eq, gte } from 'drizzle-orm';
import type { AppDeps } from '../app';
import { jobs, reviews } from '../../db/schema';
import { requireRole } from '../../auth/guards';

export function registerDashboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/dashboard', { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') }, async () => {
    const queued = deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'queued')).get()?.value ?? 0;
    const running = deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'running')).get()?.value ?? 0;
    const failed = deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'failed')).get()?.value ?? 0;
    const reviewsTotal = deps.db.select({ value: count() }).from(reviews).get()?.value ?? 0;
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const reviewsLast24h = deps.db.select({ value: count() }).from(reviews).where(gte(reviews.postedAt, since)).get()?.value ?? 0;
    return { queue: { queued, running }, reviews: { total: reviewsTotal, last24h: reviewsLast24h }, failures: failed };
  });
}
```

`src/api/routes/events.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireRole } from '../../auth/guards';

export function registerEventRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/events', { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') }, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write(': connected\n\n');
    const unsubscribe = deps.bus.subscribe((event) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
```

- [ ] **Step 3: Atualizar `AppDeps`, `src/api/app.ts` e `tests/helpers/app.ts`**

Em `src/api/app.ts`, importar `createEventBus`/`EventBus`, adicionar `bus: EventBus` a `AppDeps`, e registrar as rotas novas. Em `buildApp`, ao final, publicar no bus um evento inicial:

```ts
  registerRepositoryRoutes(app, deps);
  registerJobReadRoutes(app, deps);
  registerQueueRoutes(app, deps);
  registerSystemSettingsRoutes(app, deps);
  registerDashboardRoutes(app, deps);
  registerEventRoutes(app, deps);
```

Em `tests/helpers/app.ts`:

```ts
import { createEventBus } from '../../src/events/bus';

export function createTestDeps(): AppDeps {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
  return {
    db: createTestDb(),
    config,
    logger: createLogger(config),
    encryptionKey: loadEncryptionKey(process.env.APP_ENCRYPTION_KEY ?? ''),
    bus: createEventBus(),
  };
}
```

- [ ] **Step 4: Escrever `tests/integration/events.test.ts` e `tests/integration/dashboard.test.ts`**

`tests/integration/events.test.ts`:

```ts
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

describe('SSE', () => {
  it('entrega eventos publicados no bus', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie }, signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const connected = await reader.read();
    expect(new TextDecoder().decode(connected.value)).toContain('connected');
    deps.bus.publish({ type: 'queue.updated', data: { queued: 1 }, at: Date.now() });
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain('event: queue.updated');
    expect(text).toContain('"queued":1');
    controller.abort();
    await app.close();
  });
});
```

`tests/integration/dashboard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

describe('dashboard e fila', () => {
  it('retorna métricas zeradas e pausa/retoma', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });
    expect(dashboard.json()).toEqual({ queue: { queued: 0, running: 0 }, reviews: { total: 0, last24h: 0 }, failures: 0 });

    const pause = await app.inject({ method: 'POST', url: '/api/queue/pause', headers: { cookie } });
    expect(pause.json().paused).toBe(true);
    const queue = await app.inject({ method: 'GET', url: '/api/queue', headers: { cookie } });
    expect(queue.json().paused).toBe(true);
    const resume = await app.inject({ method: 'POST', url: '/api/queue/resume', headers: { cookie } });
    expect(resume.json().paused).toBe(false);
    await app.close();
  });

  it('valida limites das configurações do sistema', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const invalid = await app.inject({ method: 'PUT', url: '/api/settings/system', headers: { cookie }, payload: { pollingIntervalSec: 5 } });
    expect(invalid.statusCode).toBe(400);
    const valid = await app.inject({ method: 'PUT', url: '/api/settings/system', headers: { cookie }, payload: { pollingIntervalSec: 120, retentionDays: 30, concurrency: 2, ignoreDrafts: true, skipOwnPrs: false } });
    expect(valid.json().settings.pollingIntervalSec).toBe(120);
    const read = await app.inject({ method: 'GET', url: '/api/settings/system', headers: { cookie } });
    expect(read.json().settings.concurrency).toBe(2);
    await app.close();
  });
});
```

- [ ] **Step 5: Rodar e verificar**

Run: `yarn test tests/unit/bus.test.ts tests/integration/events.test.ts tests/integration/dashboard.test.ts`
Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 14: SPA React do painel

**Files:**
- Create: `index.html` movido para `src/web/index.html`, `vite.config.ts`, `src/web/main.tsx`, `src/web/app.tsx`, `src/web/api.ts`, `src/web/index.css`, `src/web/components/Layout.tsx`, `src/web/components/ProtectedRoute.tsx`, `src/web/components/ui.tsx`
- Create: `src/web/pages/Setup.tsx`, `Login.tsx`, `Dashboard.tsx`, `Reviews.tsx`, `Queue.tsx`
- Create: `src/web/pages/settings/Github.tsx`, `Profiles.tsx`, `Skills.tsx`, `Users.tsx`, `Webhooks.tsx`, `System.tsx`, `index.tsx`
- Modify: `src/api/app.ts` (servir estáticos com fallback de SPA)
- Test: `tests/web/setup.test.tsx`, `tests/web/login.test.tsx`

**Interfaces:**
- Consumes: todas as rotas REST anteriores.
- Produces: SPA compilada em `dist/web`; helper `api<T>(path, options)`.

- [ ] **Step 1: Criar `vite.config.ts`, `src/web/index.html`, `src/web/index.css`, `src/web/main.tsx`**

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/healthz': 'http://localhost:3000',
    },
  },
});
```

`src/web/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>review-bot</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.tsx"></script>
  </body>
</html>
```

`src/web/index.css`:

```css
@import "tailwindcss";

body {
  background-color: #020617;
  color: #e2e8f0;
}
```

`src/web/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 2: Criar `src/web/api.ts` e `src/web/components/ui.tsx`**

Aplicar os tokens escuros da seção "Design tokens": os trechos abaixo mostram a estrutura com classes claras; substituir por `bg-slate-900` (cards), `border-slate-800`, `text-slate-100`/`text-slate-400`, `bg-slate-800` (inputs), `bg-slate-200 text-slate-900` (botão primário). O visual final deve seguir os mockups escuros.

`src/web/api.ts`:

```ts
export class ApiRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    ...(options.body !== undefined && options.body !== null ? { 'content-type': 'application/json' } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiRequestError(data?.error?.message ?? 'Erro inesperado', data?.error?.code ?? 'unknown', response.status);
  }
  return data as T;
}
```

`src/web/components/ui.tsx`:

```tsx
import type { ReactNode } from 'react';

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {title ? <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none" />;
}

export function Button({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
      {children}
    </button>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return children ? <p className="mb-3 text-sm text-red-600">{children}</p> : null;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}
```

- [ ] **Step 3: Criar `src/web/components/ProtectedRoute.tsx`, `src/web/components/Layout.tsx` e `src/web/app.tsx`**

`src/web/components/ProtectedRoute.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet } from 'react-router-dom';
import { api } from '../api';

export type Me = { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; isRoot: boolean };

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api<{ user: Me }>('/api/auth/me')).user,
    retry: false,
  });
}

export function ProtectedRoute() {
  const me = useMe();
  if (me.isLoading) {
    return <p className="p-8 text-sm text-slate-500">Carregando…</p>;
  }
  if (me.isError || !me.data) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet context={{ user: me.data }} />;
}
```

`src/web/components/Layout.tsx`:

```tsx
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useMe } from './ProtectedRoute';

const links = [
  { to: '/', label: 'Dashboard' },
  { to: '/reviews', label: 'Reviews' },
  { to: '/queue', label: 'Fila' },
  { to: '/settings', label: 'Definições' },
];

export function Layout() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    queryClient.clear();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex gap-4 text-sm">
            {links.map((link) => (
              <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? 'font-semibold' : 'text-slate-600')} end={link.to === '/'}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{me.data?.username}</span>
            <button type="button" onClick={logout} className="text-slate-500 underline">
              Sair
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
```

`src/web/app.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './api';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Setup } from './pages/Setup';
import { Dashboard } from './pages/Dashboard';
import { Reviews } from './pages/Reviews';
import { Queue } from './pages/Queue';
import { SettingsLayout } from './pages/settings';

function SetupGate() {
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => api<{ needsSetup: boolean }>('/api/setup/status'), retry: false });
  if (status.isLoading || status.isFetching) {
    return <p className="p-8 text-sm text-slate-500">Carregando…</p>;
  }
  if (status.data?.needsSetup) {
    return <Navigate to="/setup" replace />;
  }
  return <ProtectedRoute />;
}

export function App() {
  return (
    <Routes>
      <Route path="/setup" element={<Setup />} />
      <Route path="/login" element={<Login />} />
      <Route element={<SetupGate />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/settings/*" element={<SettingsLayout />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 4: Criar as páginas principais**

`src/web/pages/Setup.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

export function Setup() {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 12) {
      setError('A senha deve ter ao menos 12 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    try {
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ token, username, password }) });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Falha ao concluir o setup.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <Card title="Configuração inicial">
          <p className="mb-4 text-sm text-slate-600">
            Use o token exibido no log do container para criar o usuário root.
          </p>
          <ErrorText>{error}</ErrorText>
          <Field label="Token de setup">
            <Input value={token} onChange={(event) => setToken(event.target.value)} autoFocus />
          </Field>
          <Field label="Usuário root">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} />
          </Field>
          <Field label="Senha">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Field label="Confirmação da senha">
            <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </Field>
          <Button type="submit">Criar root</Button>
        </Card>
      </form>
    </div>
  );
}
```

`src/web/pages/Login.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      await queryClient.invalidateQueries();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Falha ao entrar.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={submit} className="w-full max-w-sm">
        <Card title="Entrar">
          <ErrorText>{error}</ErrorText>
          <Field label="Usuário">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
          </Field>
          <Field label="Senha">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Button type="submit">Entrar</Button>
        </Card>
      </form>
    </div>
  );
}
```

`src/web/pages/Dashboard.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card } from '../components/ui';

type DashboardData = { queue: { queued: number; running: number }; reviews: { total: number; last24h: number }; failures: number };

export function Dashboard() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/api/dashboard') });
  const data = dashboard.data;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card title="Na fila">
        <p className="text-2xl font-semibold">{data?.queue.queued ?? '—'}</p>
      </Card>
      <Card title="Em execução">
        <p className="text-2xl font-semibold">{data?.queue.running ?? '—'}</p>
      </Card>
      <Card title="Reviews (24 h)">
        <p className="text-2xl font-semibold">{data?.reviews.last24h ?? '—'}</p>
      </Card>
      <Card title="Falhas">
        <p className="text-2xl font-semibold">{data?.failures ?? '—'}</p>
      </Card>
    </div>
  );
}
```

`src/web/pages/Reviews.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Card, EmptyState } from '../components/ui';

type ReviewRow = { id: string; jobId: string; status: string; url: string | null; commentsPosted: number; postedAt: number | null };

export function Reviews() {
  const reviews = useQuery({ queryKey: ['reviews'], queryFn: () => api<{ reviews: ReviewRow[] }>('/api/reviews') });

  return (
    <Card title="Reviews publicadas">
      {reviews.data && reviews.data.reviews.length === 0 ? (
        <EmptyState>Nenhuma review ainda. As reviews aparecerão aqui quando o pipeline estiver ativo.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-2">Status</th>
              <th className="py-2">Comentários</th>
              <th className="py-2">Link</th>
            </tr>
          </thead>
          <tbody>
            {reviews.data?.reviews.map((review) => (
              <tr key={review.id} className="border-t border-slate-100">
                <td className="py-2">{review.status}</td>
                <td className="py-2">{review.commentsPosted}</td>
                <td className="py-2">{review.url ? <a className="underline" href={review.url}>abrir</a> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
```

`src/web/pages/Queue.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, EmptyState } from '../components/ui';

type QueueData = { queued: number; running: number; paused: boolean };
type JobRow = { id: string; prTitle: string; prUrl: string; status: string; runSeq: number; queuedAt: number };

export function Queue() {
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api<QueueData>('/api/queue') });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<{ jobs: JobRow[] }>('/api/jobs') });
  const toggle = useMutation({
    mutationFn: (paused: boolean) => api(paused ? '/api/queue/resume' : '/api/queue/pause', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue'] }),
  });

  return (
    <div className="space-y-4">
      <Card title="Fila">
        <div className="flex items-center gap-4">
          <p className="text-sm text-slate-600">Na fila: {queue.data?.queued ?? '—'} · Em execução: {queue.data?.running ?? '—'}</p>
          <Button type="button" onClick={() => toggle.mutate(queue.data?.paused ?? false)} disabled={toggle.isPending}>
            {queue.data?.paused ? 'Retomar' : 'Pausar'}
          </Button>
        </div>
      </Card>
      <Card title="Jobs">
        {jobs.data && jobs.data.jobs.length === 0 ? (
          <EmptyState>Nenhum job ainda. Eles aparecerão quando um review for solicitado à conta configurada.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {jobs.data?.jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between py-2">
                <a className="underline" href={job.prUrl}>{job.prTitle}</a>
                <span className="text-slate-500">{job.status} · run {job.runSeq}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Criar as páginas de definições**

`src/web/pages/settings/index.tsx`:

```tsx
import { NavLink, Route, Routes } from 'react-router-dom';
import { GithubSettings } from './Github';
import { Profiles } from './Profiles';
import { Skills } from './Skills';
import { Users } from './Users';
import { Webhooks } from './Webhooks';
import { SystemSettings } from './System';

const tabs = [
  { to: 'github', label: 'GitHub' },
  { to: 'ia', label: 'IA' },
  { to: 'skills', label: 'Skills' },
  { to: 'usuarios', label: 'Usuários' },
  { to: 'webhooks', label: 'Webhooks' },
  { to: 'sistema', label: 'Sistema' },
];

export function SettingsLayout() {
  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-3 text-sm">
        {tabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className={({ isActive }) => (isActive ? 'font-semibold' : 'text-slate-600')}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route path="github" element={<GithubSettings />} />
        <Route path="ia" element={<Profiles />} />
        <Route path="skills" element={<Skills />} />
        <Route path="usuarios" element={<Users />} />
        <Route path="webhooks" element={<Webhooks />} />
        <Route path="sistema" element={<SystemSettings />} />
      </Routes>
    </div>
  );
}
```

`src/web/pages/settings/Github.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type GithubInfo = { login: string; patLast4: string; scopes: string } | null;

export function GithubSettings() {
  const queryClient = useQueryClient();
  const [pat, setPat] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const current = useQuery({ queryKey: ['github'], queryFn: () => api<{ credentials: GithubInfo }>('/api/settings/github') });

  const save = useMutation({
    mutationFn: () => api('/api/settings/github', { method: 'PUT', body: JSON.stringify({ pat }) }),
    onSuccess: () => {
      setMessage('Credencial salva.');
      setPat('');
      queryClient.invalidateQueries({ queryKey: ['github'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao salvar.'),
  });

  return (
    <Card title="Conta GitHub">
      <p className="mb-3 text-sm text-slate-600">
        {current.data?.credentials
          ? `Conectado como ${current.data.credentials.login} (token ••••${current.data.credentials.patLast4})`
          : 'Nenhuma credencial configurada.'}
      </p>
      <ErrorText>{error}</ErrorText>
      {message ? <p className="mb-3 text-sm text-green-700">{message}</p> : null}
      <Field label="Personal Access Token">
        <Input type="password" value={pat} onChange={(event) => setPat(event.target.value)} />
      </Field>
      <Button type="button" onClick={() => { setError(''); setMessage(''); save.mutate(); }} disabled={save.isPending || pat.length < 20}>
        Salvar e testar
      </Button>
    </Card>
  );
}
```

`src/web/pages/settings/Profiles.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type Profile = { id: string; name: string; provider: string; model: string; isActive: boolean; hasApiKey: boolean };

export function Profiles() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => api<{ profiles: Profile[] }>('/api/ai-profiles') });
  const [form, setForm] = useState({ name: '', provider: 'openai_compatible', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' });
  const [error, setError] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['profiles'] });
  const create = useMutation({
    mutationFn: () => api('/api/ai-profiles', { method: 'POST', body: JSON.stringify({ ...form, skillIds: [] }) }),
    onSuccess: () => { setForm({ ...form, name: '', model: '', apiKey: '' }); setError(''); refresh(); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar perfil.'),
  });
  const activate = useMutation({ mutationFn: (id: string) => api(`/api/ai-profiles/${id}/activate`, { method: 'POST' }), onSuccess: refresh });
  const test = useMutation({ mutationFn: (id: string) => api(`/api/ai-profiles/${id}/test`, { method: 'POST', body: '{}' }) });

  return (
    <div className="space-y-4">
      <Card title="Perfis de IA">
        <ul className="divide-y divide-slate-100 text-sm">
          {profiles.data?.profiles.map((profile) => (
            <li key={profile.id} className="flex items-center justify-between py-2">
              <span>
                {profile.name} · {profile.provider} · {profile.model} {profile.isActive ? '· ativo' : ''}
              </span>
              <span className="flex gap-2">
                <Button type="button" onClick={() => test.mutate(profile.id)}>Testar</Button>
                {profile.isActive ? null : <Button type="button" onClick={() => activate.mutate(profile.id)}>Ativar</Button>}
              </span>
            </li>
          ))}
          {profiles.data && profiles.data.profiles.length === 0 ? <li className="py-4 text-slate-500">Nenhum perfil ainda.</li> : null}
        </ul>
        {test.isError ? <p className="mt-2 text-sm text-red-600">Falha no teste do provedor.</p> : null}
      </Card>
      <Card title="Novo perfil">
        <ErrorText>{error}</ErrorText>
        <Field label="Nome"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Provedor">
          <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm" value={form.provider} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
            <option value="openai_compatible">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </Field>
        <Field label="Base URL"><Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} /></Field>
        <Field label="Modelo"><Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></Field>
        <Field label="Chave de API"><Input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></Field>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>Criar perfil</Button>
      </Card>
    </div>
  );
}
```

`src/web/pages/settings/Skills.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type Skill = { id: string; name: string; description: string; contentMd: string };

export function Skills() {
  const queryClient = useQueryClient();
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<{ skills: Skill[] }>('/api/skills') });
  const [form, setForm] = useState({ name: '', description: '', contentMd: '' });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => api('/api/skills', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { setForm({ name: '', description: '', contentMd: '' }); setError(''); queryClient.invalidateQueries({ queryKey: ['skills'] }); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar skill.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  return (
    <div className="space-y-4">
      <Card title="Skills">
        <ul className="divide-y divide-slate-100 text-sm">
          {skills.data?.skills.map((skill) => (
            <li key={skill.id} className="flex items-center justify-between py-2">
              <span>{skill.name} · {skill.description || 'sem descrição'}</span>
              <Button type="button" onClick={() => remove.mutate(skill.id)}>Remover</Button>
            </li>
          ))}
          {skills.data && skills.data.skills.length === 0 ? <li className="py-4 text-slate-500">Nenhuma skill ainda.</li> : null}
        </ul>
      </Card>
      <Card title="Nova skill">
        <ErrorText>{error}</ErrorText>
        <Field label="Nome"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
        <Field label="Descrição"><Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></Field>
        <Field label="Conteúdo (Markdown)">
          <textarea className="h-32 w-full rounded border border-slate-300 px-3 py-2 text-sm" value={form.contentMd} onChange={(event) => setForm({ ...form, contentMd: event.target.value })} />
        </Field>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>Criar skill</Button>
      </Card>
    </div>
  );
}
```

`src/web/pages/settings/Users.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type UserRow = { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; isRoot: boolean; disabled: boolean };

export function Users() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: UserRow[] }>('/api/users') });
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer' });
  const [error, setError] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({
    mutationFn: () => api('/api/users', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => { setForm({ username: '', password: '', role: 'viewer' }); setError(''); refresh(); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar usuário.'),
  });
  const patch = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) => api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ disabled }) }),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao alterar usuário.'),
  });

  return (
    <div className="space-y-4">
      <Card title="Usuários">
        <ErrorText>{error}</ErrorText>
        <ul className="divide-y divide-slate-100 text-sm">
          {users.data?.users.map((user) => (
            <li key={user.id} className="flex items-center justify-between py-2">
              <span>{user.username} · {user.role} {user.isRoot ? '· root' : ''} {user.disabled ? '· desativado' : ''}</span>
              {user.isRoot ? null : (
                <Button type="button" onClick={() => patch.mutate({ id: user.id, disabled: !user.disabled })}>
                  {user.disabled ? 'Ativar' : 'Desativar'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Novo usuário">
        <Field label="Usuário"><Input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></Field>
        <Field label="Senha"><Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
        <Field label="Papel">
          <select className="w-full rounded border border-slate-300 px-3 py-2 text-sm" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>Criar usuário</Button>
      </Card>
    </div>
  );
}
```

`src/web/pages/settings/Webhooks.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

const ALL_EVENTS = ['review.published', 'job.failed', 'job.partial', 'poller.paused'];
type WebhookRow = { id: string; url: string; events: string[]; enabled: boolean };

export function Webhooks() {
  const queryClient = useQueryClient();
  const webhooks = useQuery({ queryKey: ['webhooks'], queryFn: () => api<{ webhooks: WebhookRow[] }>('/api/webhooks') });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['review.published', 'job.failed']);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['webhooks'] });
  const create = useMutation({
    mutationFn: () => api<{ secret: string }>('/api/webhooks', { method: 'POST', body: JSON.stringify({ url, events }) }),
    onSuccess: (data) => { setSecret(data.secret); setUrl(''); setError(''); refresh(); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar webhook.'),
  });
  const test = useMutation({ mutationFn: (id: string) => api<{ ok: boolean }>(`/api/webhooks/${id}/test`, { method: 'POST' }) });

  return (
    <div className="space-y-4">
      <Card title="Webhooks">
        <ErrorText>{error}</ErrorText>
        {secret ? <p className="mb-3 text-sm text-amber-700">Secret gerado (exibido uma única vez): <code>{secret}</code></p> : null}
        <ul className="divide-y divide-slate-100 text-sm">
          {webhooks.data?.webhooks.map((webhook) => (
            <li key={webhook.id} className="flex items-center justify-between py-2">
              <span>{webhook.url} · {webhook.events.join(', ')}</span>
              <Button type="button" onClick={() => test.mutate(webhook.id)}>Testar</Button>
            </li>
          ))}
          {webhooks.data && webhooks.data.webhooks.length === 0 ? <li className="py-4 text-slate-500">Nenhum webhook ainda.</li> : null}
        </ul>
        {test.isSuccess ? <p className="mt-2 text-sm text-green-700">Entrega disparada.</p> : null}
      </Card>
      <Card title="Novo webhook">
        <Field label="URL"><Input value={url} onChange={(event) => setUrl(event.target.value)} /></Field>
        <fieldset className="mb-3 text-sm">
          <legend className="mb-1 font-medium text-slate-700">Eventos</legend>
          {ALL_EVENTS.map((event) => (
            <label key={event} className="mr-3 inline-flex items-center gap-1">
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={(changeEvent) => setEvents(changeEvent.target.checked ? [...events, event] : events.filter((item) => item !== event))}
              />
              {event}
            </label>
          ))}
        </fieldset>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending || url.length === 0 || events.length === 0}>Criar webhook</Button>
      </Card>
    </div>
  );
}
```

`src/web/pages/settings/System.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type SystemSettingsData = { pollingIntervalSec: number; retentionDays: number; concurrency: number; ignoreDrafts: boolean; skipOwnPrs: boolean };

export function SystemSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['system'], queryFn: () => api<{ settings: SystemSettingsData }>('/api/settings/system') });
  const [form, setForm] = useState<SystemSettingsData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (settings.data && !form) {
      setForm(settings.data.settings);
    }
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: () => api('/api/settings/system', { method: 'PUT', body: JSON.stringify(form) }),
    onSuccess: () => { setError(''); queryClient.invalidateQueries({ queryKey: ['system'] }); },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao salvar.'),
  });

  if (!form) {
    return <Card title="Sistema">Carregando…</Card>;
  }

  return (
    <Card title="Sistema">
      <ErrorText>{error}</ErrorText>
      <Field label="Intervalo de polling (segundos)">
        <Input type="number" value={form.pollingIntervalSec} onChange={(event) => setForm({ ...form, pollingIntervalSec: Number(event.target.value) })} />
      </Field>
      <Field label="Retenção de logs (dias)">
        <Input type="number" value={form.retentionDays} onChange={(event) => setForm({ ...form, retentionDays: Number(event.target.value) })} />
      </Field>
      <Field label="Concorrência (1–3)">
        <Input type="number" value={form.concurrency} onChange={(event) => setForm({ ...form, concurrency: Number(event.target.value) })} />
      </Field>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.ignoreDrafts} onChange={(event) => setForm({ ...form, ignoreDrafts: event.target.checked })} />
        Ignorar PRs em rascunho
      </label>
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.skipOwnPrs} onChange={(event) => setForm({ ...form, skipOwnPrs: event.target.checked })} />
        Ignorar PRs da própria conta
      </label>
      <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>
    </Card>
  );
}
```

- [ ] **Step 6: Servir o SPA pelo Fastify**

Em `src/api/app.ts`, adicionar antes do retorno de `buildApp`:

```ts
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';

  const webRoot = join(process.cwd(), 'dist', 'web');
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send(errorBody('not_found', 'Rota não encontrada'));
      }
      return reply.sendFile('index.html');
    });
  }
```

- [ ] **Step 7: Escrever os testes de componente**

`tests/web/setup.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Setup } from '../../src/web/pages/Setup';

describe('Setup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra erro quando as senhas não coincidem', async () => {
    render(<MemoryRouter><Setup /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-longa');
    await userEvent.type(screen.getByLabelText('Confirmação da senha'), 'outra-senha-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    expect(await screen.findByText('As senhas não coincidem.')).toBeInTheDocument();
  });

  it('envia o setup quando os dados são válidos', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ userId: '1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter><Setup /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('Token de setup'), 'token-de-setup-de-teste-123456');
    await userEvent.type(screen.getByLabelText('Usuário root'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-longa');
    await userEvent.type(screen.getByLabelText('Confirmação da senha'), 'senha-muito-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/setup', expect.objectContaining({ method: 'POST' })));
  });
});
```

Nota: os rótulos dos campos usam `<span>` dentro do `<label>`, então `getByLabelText` funciona por associação implícita.

`tests/web/login.test.tsx`:

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../../src/web/pages/Login';

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Login /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Login', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra mensagem para credenciais inválidas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_credentials', message: 'Credenciais inválidas' } }), { status: 401 })));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Usuário'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Credenciais inválidas')).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Rodar e verificar**

Run: `yarn test tests/web/setup.test.tsx tests/web/login.test.tsx; yarn build:web`
Expected: testes PASS e build gerando `dist/web/index.html`.

- [ ] **Step 9: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test; yarn build:web`
Expected: todos verdes.

---

### Task 15: Docker, Compose e README

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.env.example`, `.dockerignore`, `README.md`
- Test: verificação de build e de configuração do Compose.

**Interfaces:**
- Consumes: `yarn build` (gera `dist/server/server.js` e `dist/web`), `drizzle/`.
- Produces: imagem `review-bot` executável com volume `/data`.

- [ ] **Step 1: Criar `Dockerfile`**

```dockerfile
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable
COPY . .
RUN yarn build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/server/server.js"]
```

- [ ] **Step 2: Criar `docker-compose.yml`, `.env.example` e `.dockerignore`**

`docker-compose.yml`:

```yaml
services:
  app:
    build: .
    image: review-bot:local
    env_file: .env
    ports:
      - "3000:3000"
    volumes:
      - data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  data:
```

`.env.example`:

```
APP_ENCRYPTION_KEY=
PUBLIC_URL=http://localhost:3000
DATA_DIR=/data
PORT=3000
TRUST_PROXY=false
ALLOW_PRIVATE_URLS=false
LOG_LEVEL=info
TZ=UTC
```

`.dockerignore`:

```
node_modules
dist
data
.env
coverage
```

- [ ] **Step 3: Implementar `src/server.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { loadEncryptionKey } from './auth/crypto';
import { ensureSetupToken } from './auth/setup';
import { createEventBus } from './events/bus';
import { buildApp } from './api/app';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  mkdirSync(config.DATA_DIR, { recursive: true });
  const { db } = createDb(join(config.DATA_DIR, 'review-bot.db'));
  runMigrations(db, join(process.cwd(), 'drizzle'));
  const encryptionKey = loadEncryptionKey(config.APP_ENCRYPTION_KEY);
  ensureSetupToken(db, logger, config.SETUP_TOKEN);
  const app = await buildApp({ db, config, logger, encryptionKey, bus: createEventBus() });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'review-bot iniciado');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'encerrando');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
```

- [ ] **Step 4: Criar `README.md`**

```markdown
# review-bot

Painel e automação de review de Pull Requests. Esta fase entrega a fundação: setup do root, autenticação, usuários com papéis, definições de GitHub, perfis de IA, skills, webhooks, repositórios, fila (somente leitura), dashboard e SSE. O poller e o worker de review chegam na próxima fase.

## Instalação

1. Copie `.env.example` para `.env` e gere a chave: `openssl rand -base64 32` em `APP_ENCRYPTION_KEY`.
2. Ajuste `PUBLIC_URL` para a URL pública (o TLS fica a cargo do seu proxy reverso).
3. `docker compose up -d`.
4. Leia o token de setup: `docker compose logs app`.
5. Acesse o painel e crie o usuário root.

## Desenvolvimento

- `yarn install`
- `yarn dev` (API em http://localhost:3000)
- `yarn dev:web` (SPA em http://localhost:5173 com proxy para a API)
- `yarn test`, `yarn typecheck`, `yarn lint`

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `APP_ENCRYPTION_KEY` | 32 bytes em base64 (obrigatória) |
| `SETUP_TOKEN` | Substitui o token de setup gerado |
| `PUBLIC_URL` | URL pública (obrigatória em produção) |
| `DATA_DIR` | Diretório do SQLite (padrão `/data` na imagem) |
| `TRUST_PROXY` | Confia em cabeçalhos do proxy |
| `ALLOW_PRIVATE_URLS` | Permite provedores/webhooks em rede privada |

## Backup

Com o container em execução, copie `data/review-bot.db` usando `sqlite3 .backup` ou pare o container antes de copiar (WAL). O script de backup automatizado chega na fase de operação.
```

- [ ] **Step 5: Verificar build e Compose**

Run: `yarn build`
Expected: `dist/server/server.js` e `dist/web/index.html` existem.

Run: `Copy-Item .env.example .env` e preencher `APP_ENCRYPTION_KEY` com uma chave de 32 bytes em base64 (ex.: `MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=`).

Run: `docker compose config` (se Docker estiver instalado)
Expected: YAML válido com o serviço `app` e o volume `data`.

- [ ] **Step 6: Smoke manual**

PowerShell:

```powershell
$env:APP_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
$env:DATA_DIR = "$env:TEMP\review-bot-smoke"
$env:PORT = "3210"
node dist/server/server.js
```

Em outro terminal:

```powershell
curl.exe -s http://127.0.0.1:3210/healthz
curl.exe -s http://127.0.0.1:3210/api/setup/status
```

Expected: `{"status":"ok"}` e `{"needsSetup":true}`; o log do servidor mostra o token de setup. Encerre com Ctrl+C.

- [ ] **Step 7: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test; yarn build`
Expected: todos verdes.

---

### Task 16: Verificação final do Plano 1

**Files:**
- Nenhum arquivo novo.

- [ ] **Step 1: Rodar a suíte completa**

Run: `yarn typecheck; yarn lint; yarn test; yarn build`
Expected: typecheck sem erros, lint sem avisos, todos os testes PASS, build concluído.

- [ ] **Step 2: Conferir a cobertura do spec neste plano**

| Requisito | Onde |
|---|---|
| RF-01 setup com token | Task 5 |
| RF-02 autenticação | Task 6 |
| RF-03 usuários e papéis | Task 7 |
| RF-04 credencial GitHub | Task 9 |
| RF-18 perfis de IA | Task 10 |
| RF-19 skills | Task 11 |
| RF-20 webhooks | Task 12 |
| RF-21 auditoria | Tasks 7, 9-12 |
| RF-22 retenção (infra) | Tasks 3, 13 (configuração); rotina chega no Plano 3 |
| RF-24 saúde | Tasks 1, 13 |
| RNF-01 segurança | Tasks 4, 6, 8 |
| RNF-06/07 portabilidade e operação | Tasks 15 |
| Painel e SSE | Tasks 13, 14 |
| Fila somente leitura | Task 13 |

Fora deste plano (Plano 2): RF-05 descoberta por polling, RF-06, RF-07, RF-08 execução, RF-09 a RF-15, RF-16/17 dados reais. Fora do Plano 2 (Plano 3): RF-22 rotina de limpeza, backup, E2E completo, endurecimento.

- [ ] **Step 3: Revisar pendências conhecidas**

- `testProfile` usa `allowPrivate: true`; o Plano 2 deve aplicar `ALLOW_PRIVATE_URLS` nas chamadas de review e registrar a decisão.
- A fila está somente leitura; pausar/retomar já persiste o estado que o Plano 2 consumirá.
- A rota `/api/events` entrega eventos; o Plano 2 publica `job.*` e `poll.*`.
- Sem git: não há commits; ao inicializar um repositório no futuro, cada tarefa vira um commit.


