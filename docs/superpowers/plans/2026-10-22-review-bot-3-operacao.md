# review-bot — Plano 3: Operação e Endurecimento

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar as pendências de produção: PRs de fork, `ALLOW_PRIVATE_URLS` real, cancelamento cooperativo, retenção, backup, reset de senha, saúde, segurança testada, E2E Playwright, dashboard operacional completo, conformidade visual com os mockups, documentação de deploy e checklist de aceite.

**Architecture:** Sem novos componentes; ajustes no worker, no poller, no publicador e nos scripts operacionais. O container continua único; backup e reset rodam dentro do container pelo operador.

**Tech Stack:** Node 22, better-sqlite3, @node-rs/argon2, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-pr-review-agent-design.md` (seções 12-16).

## Global Constraints

- Restrições dos Planos 1 e 2 continuam válidas.
- Scripts operacionais não podem receber segredos por argumento de linha de comando (senha via stdin interativo).
- Backup usa a API de backup do SQLite (seguro com WAL).
- Nenhuma migração destrutiva sem backup documentado.
- Testes de segurança não podem depender de rede externa.

## Mudanças de schema (Task 1)

- `jobs` ganha `head_repo` (texto `owner/repo` do repositório head; igual ao base na maioria dos casos, diferente em forks).
- `pr_seen` ganha `head_repo`.

---

### Task 1: Pendências de robustez (fork, SSRF configurável, cancelamento)

**Files:**
- Modify: `src/db/schema.ts` (jobs.head_repo, pr_seen.head_repo)
- Modify: `src/github/poller.ts`, `src/jobs/queue.ts`, `src/jobs/execute.ts`, `src/ai/loop.ts`, `src/jobs/worker.ts`, `src/ai/profiles.ts`, `src/api/routes/ai-profiles.ts`, `src/server.ts`
- Test: `tests/integration/fork-and-cancel.test.ts`

**Interfaces:**
- Consumes: tudo dos Planos 1-2.
- Produces: `jobs.headRepo`; `WorkerDeps.allowPrivate: boolean`; `LoopDeps.shouldCancel?: () => boolean`; `CancelledError` em `src/jobs/worker.ts`; `testProfile(db, key, id, options: { overrideApiKey?: string; allowPrivate: boolean })`; `dispatchEvent` chamado com `allowPrivate` da config.

- [x] **Step 1: Schema e migration**

Adicionar `headRepo: text('head_repo')` a `jobs` e `pr_seen`; rodar `yarn db:generate`.

No poller, gravar `head_repo` a partir de `pull.head.repo?.full_name ?? repo.full_name`; em `enqueueManual`, usar o mesmo campo (buscar `head.repo`).

- [x] **Step 2: Usar o repositório head nas ferramentas e o base na publicação**

Em `executeJob`:

```ts
  const headRepoFullName = job.headRepo ?? repo.fullName;
  const head = headRepoFullName.split('/');
  if (!head[0] || !head[1]) {
    throw new Error('Repositório head inválido');
  }
  const headOwner = head[0];
  const headName = head[1];
  const filesRaw = await paginate<PrFile>(`/repos/${repo.owner}/${repo.name}/pulls/${job.prNumber}/files`, { token, fetchImpl, maxPages: 4 });
  const validLines = validRightLines(files.flatMap((file) => file.hunks));
  const tools = {
    // ...
    baseRepo: { owner: repo.owner, name: repo.name },
    headRepoFullName,
    headSha: job.headSha,
    // ...
  };
```

As ferramentas de leitura (`read_file`, `list_directory`, `list_tree`) passam a usar `ctx.headRepoFullName`; `search_code` continua no repo base. A publicação continua no repo base (`publishReview` usa `repo.owner/repo.name`).

- [x] **Step 3: `ALLOW_PRIVATE_URLS` real**

- Em `WorkerDeps`, adicionar `allowPrivate: boolean`.
- Em `executeJob`, trocar as chamadas de `dispatchEvent(... allowPrivate: false ...)` por `allowPrivate: deps.allowPrivate`.
- Em `src/server.ts`, ao criar o worker, passar `allowPrivate: config.ALLOW_PRIVATE_URLS`.
- Em `testProfile`, trocar `assertSafeUrl(row.baseUrl, { allowPrivate: true })` por opções explícitas; a rota `/api/ai-profiles/:id/test` passa `allowPrivate: deps.config.ALLOW_PRIVATE_URLS`. O formulário de perfil continua aceitando URLs privadas apenas quando a flag está ligada.

- [x] **Step 4: Cancelamento cooperativo**

Em `src/jobs/worker.ts`:

```ts
export class CancelledError extends Error {}
```

Em `src/ai/loop.ts`, adicionar `shouldCancel?: () => boolean` a `LoopDeps`; no topo de cada iteração do `while`:

```ts
    if (deps.shouldCancel?.()) {
      throw new Error('job_cancelled');
    }
```

No `executeJob`, passar `shouldCancel: () => isJobCancelled(deps.db, job.id)`; no worker, capturar:

```ts
      if (error instanceof Error && error.message === 'job_cancelled') {
        markJobFinished(deps.db, job.id, { status: 'cancelled', now: (deps.now ?? Date.now)() });
        emit(deps, job.id, 'job.finished', 'Job cancelado', { status: 'cancelled' });
      } else if (...)
```

Nota: alterar também `markJobFinished` em `src/jobs/queue.ts` para aceitar `'cancelled'` no tipo do patch:

```ts
export function markJobFinished(db: Db, jobId: string, patch: { status: 'succeeded' | 'partial' | 'failed' | 'cancelled'; errorCode?: string; errorMessage?: string; usageJson?: string; now?: number }): void {
```

- [x] **Step 5: Escrever `tests/integration/fork-and-cancel.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { jobs, repositories } from '../../src/db/schema';
import { v7 as uuidv7 } from 'uuid';
import { cancelJob } from '../../src/jobs/queue';
import { createWorker } from '../../src/jobs/worker';
import { runAgentLoop } from '../../src/ai/loop';
import { createTestDb } from '../helpers/db';

describe('fork e cancelamento', () => {
  it('lê arquivos do repo head e publica no base', async () => {
    const { app, deps } = await createTestApp();
    await app.close();
    const now = Date.now();
    deps.db.insert(repositories).values({ id: 'r1', githubId: '1', owner: 'acme', name: 'api', fullName: 'acme/api', private: true, archived: false, enabled: true, discoveredAt: now, updatedAt: now }).run();
    const id = uuidv7();
    deps.db.insert(jobs).values({ id, repositoryId: 'r1', prNumber: 7, prTitle: 't', prUrl: 'u', authorLogin: 'x', headSha: 'sha', baseSha: 'b', headRepo: 'fork/api', runSeq: 1, status: 'running', priority: 0, attempts: 1, maxAttempts: 3, queuedAt: now }).run();
    const job = deps.db.select().from(jobs).get()!;
    expect(job.headRepo).toBe('fork/api');

    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url));
      if (String(url).includes('fork/api/contents')) {
        return new Response(JSON.stringify({ content: Buffer.from('x').toString('base64'), encoding: 'base64' }), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as unknown as typeof fetch);
    const { executeTool } = await import('../../src/ai/tools');
    await executeTool('read_file', JSON.stringify({ path: 'src/a.ts' }), {
      db: deps.db, job, token: 't', baseRepo: { owner: 'acme', name: 'api' }, headRepoFullName: 'fork/api', headSha: 'sha', prNumber: 7,
      files: [], validLines: new Set(), calls: { count: 0, max: 80 }, searchCalls: { count: 0, max: 5 }, maxFindings: 25,
    });
    expect(seen.some((url) => url.includes('fork/api/contents'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('cancelar durante o loop interrompe a execução', async () => {
    const db = createTestDb();
    const now = Date.now();
    db.insert(repositories).values({ id: 'r1', githubId: '1', owner: 'a', name: 'b', fullName: 'a/b', private: false, archived: false, enabled: true, discoveredAt: now, updatedAt: now }).run();
    db.insert(jobs).values({ id: 'j1', repositoryId: 'r1', prNumber: 1, prTitle: 't', prUrl: 'u', authorLogin: 'x', headSha: 's', baseSha: 'b', runSeq: 1, status: 'running', priority: 0, attempts: 1, maxAttempts: 3, queuedAt: now }).run();
    let cancelled = false;
    const bus = (await import('../../src/events/bus')).createEventBus();
    await expect(runAgentLoop({
      db, bus, job: db.select().from(jobs).get()!,
      profileSnapshot: { name: 'p', provider: 'openai_compatible', model: 'm', temperature: 0.2, maxTurns: 5, maxTotalTokens: 10000, maxDurationSec: 60, maxFindings: 5, maxGithubCalls: 10, prePrompt: '' },
      baseUrl: 'https://p.exemplo.com/v1', apiKey: 'k', skills: [], userPrompt: 'x',
      shouldCancel: () => cancelled,
      chatImpl: async () => { cancelled = true; return { toolCalls: [{ id: 'c1', name: 'list_tree', argumentsJson: '{}' }], usage: { input: 1, output: 1 }, finishReason: 'tool_calls' }; },
      tools: { db, job: db.select().from(jobs).get()!, token: 't', baseRepo: { owner: 'a', name: 'b' }, headRepoFullName: 'a/b', headSha: 's', prNumber: 1, files: [], validLines: new Set(), calls: { count: 0, max: 10 }, searchCalls: { count: 0, max: 1 }, maxFindings: 5 },
    })).rejects.toThrow('job_cancelled');
  });
});
```

- [x] **Step 6: Rodar e verificar**

Run: `yarn test tests/integration/fork-and-cancel.test.ts`
Expected: PASS.

- [x] **Step 7: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 2: Retenção e limpeza

**Files:**
- Create: `src/ops/retention.ts`
- Modify: `src/server.ts` (agendar limpeza diária)
- Test: `tests/unit/retention.test.ts`

**Interfaces:**
- Consumes: `Db`, `getSystemSettings`, `agent_messages`, `events`, `webhook_deliveries`, `github_cache`, `audit_log`.
- Produces: `runRetention(db, now?): { messages: number; events: number; deliveries: number; cache: number; audit: number }`.

- [x] **Step 1: Implementar `src/ops/retention.ts`**

```ts
import { lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { agentMessages, auditLog, events, githubCache, webhookDeliveries } from '../db/schema';
import { getSystemSettings } from '../api/routes/settings-system';

export function runRetention(db: Db, now = Date.now()): { messages: number; events: number; deliveries: number; cache: number; audit: number } {
  const settings = getSystemSettings(db);
  const cutoff = now - settings.retentionDays * 24 * 60 * 60 * 1000;
  const auditCutoff = now - 180 * 24 * 60 * 60 * 1000;
  const messages = db.delete(agentMessages).where(lt(agentMessages.createdAt, cutoff)).run().changes;
  const removedEvents = db.delete(events).where(lt(events.createdAt, cutoff)).run().changes;
  const deliveries = db.delete(webhookDeliveries).where(lt(webhookDeliveries.createdAt, cutoff)).run().changes;
  const cache = db.delete(githubCache).where(lt(githubCache.expiresAt, now)).run().changes;
  const audit = db.delete(auditLog).where(lt(auditLog.createdAt, auditCutoff)).run().changes;
  return { messages, events: removedEvents, deliveries, cache, audit };
}
```

- [x] **Step 2: Agendar no `src/server.ts`**

```ts
  const retentionTimer = setInterval(() => {
    try {
      const removed = runRetention(db);
      logger.info({ removed }, 'retenção executada');
    } catch (error) {
      logger.warn({ err: error }, 'falha na retenção');
    }
  }, 24 * 60 * 60 * 1000);
```

E limpar o timer no shutdown.

- [x] **Step 3: Escrever `tests/unit/retention.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/db';
import { agentMessages, auditLog, events, githubCache, webhookDeliveries, jobs, repositories } from '../../src/db/schema';
import { runRetention } from '../../src/ops/retention';
import { v7 as uuidv7 } from 'uuid';

describe('retenção', () => {
  it('remove dados antigos e preserva recentes', () => {
    const db = createTestDb();
    const now = Date.now();
    const old = now - 120 * 24 * 60 * 60 * 1000;
    db.insert(repositories).values({ id: 'r1', githubId: '1', owner: 'a', name: 'b', fullName: 'a/b', private: false, archived: false, enabled: true, discoveredAt: now, updatedAt: now }).run();
    db.insert(jobs).values({ id: 'j1', repositoryId: 'r1', prNumber: 1, prTitle: 't', prUrl: 'u', authorLogin: 'x', headSha: 's', baseSha: 'b', runSeq: 1, status: 'succeeded', priority: 0, attempts: 1, maxAttempts: 3, queuedAt: now }).run();
    db.insert(agentMessages).values({ id: uuidv7(), jobId: 'j1', seq: 1, role: 'user', contentJson: '{}', createdAt: old }).run();
    db.insert(agentMessages).values({ id: uuidv7(), jobId: 'j1', seq: 2, role: 'user', contentJson: '{}', createdAt: now }).run();
    db.insert(events).values({ id: uuidv7(), jobId: 'j1', level: 'info', type: 'x', message: 'm', createdAt: old }).run();
    db.insert(githubCache).values({ key: 'k', etag: 'e', payloadJson: '{}', expiresAt: old }).run();
    db.insert(auditLog).values({ id: uuidv7(), action: 'a', createdAt: old }).run();
    const removed = runRetention(db, now);
    expect(removed.messages).toBe(1);
    expect(removed.events).toBe(1);
    expect(removed.cache).toBe(1);
    expect(db.select().from(agentMessages).all()).toHaveLength(1);
    expect(db.select().from(auditLog).all()).toHaveLength(0);
  });
});
```

- [x] **Step 4: Rodar e verificar**

Run: `yarn test tests/unit/retention.test.ts`
Expected: PASS.

- [x] **Step 5: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 3: Scripts de backup e reset de senha

**Files:**
- Create: `scripts/backup.mjs`, `scripts/reset-password.mjs`
- Test: `tests/integration/scripts.test.ts`

**Interfaces:**
- Consumes: `better-sqlite3`, `@node-rs/argon2`, env `DATA_DIR`.
- Produces: `node scripts/backup.mjs` (copia consistente para `data/backups/review-bot-<timestamp>.db`); `node scripts/reset-password.mjs <username>` (lê a nova senha do stdin).

- [x] **Step 1: Implementar `scripts/backup.mjs`**

```js
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dataDir = process.env.DATA_DIR ?? './data';
const source = join(dataDir, 'review-bot.db');
const outDir = join(dataDir, 'backups');
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(outDir, `review-bot-${stamp}.db`);
const db = new Database(source, { readonly: true });
await db.backup(target);
db.close();
console.log(target);
```

- [x] **Step 2: Implementar `scripts/reset-password.mjs`**

```js
import Database from 'better-sqlite3';
import { hash } from '@node-rs/argon2';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';

const username = process.argv[2];
if (!username) {
  console.error('Uso: node scripts/reset-password.mjs <username>');
  process.exit(1);
}
const db = new Database(join(process.env.DATA_DIR ?? './data', 'review-bot.db'));
const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
if (!user) {
  console.error('Usuário não encontrado');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Nova senha (mínimo 12 caracteres): ');
rl.close();
if (password.length < 12) {
  console.error('Senha curta');
  process.exit(1);
}
const passwordHash = await hash(password, { memoryCost: 65536, timeCost: 3, parallelism: 1 });
db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, Date.now(), user.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
db.close();
console.log('Senha redefinida e sessões revogadas.');
```

- [x] **Step 3: Escrever `tests/integration/scripts.test.ts`**

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { verify } from '@node-rs/argon2';
import { createDb, type Db } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';
import { users } from '../../src/db/schema';
import { hashPassword } from '../../src/auth/password';
import { v7 as uuidv7 } from 'uuid';

function tempDb(): { dir: string; db: Db } {
  const dir = mkdtempSync(join(tmpdir(), 'review-bot-'));
  const { db } = createDb(join(dir, 'review-bot.db'));
  runMigrations(db, 'drizzle');
  return { dir, db };
}

describe('scripts operacionais', () => {
  it('backup cria cópia consistente', () => {
    const { dir, db } = tempDb();
    const now = Date.now();
    db.insert(users).values({ id: uuidv7(), username: 'root', passwordHash: 'h', role: 'admin', isRoot: true, disabled: false, createdAt: now, updatedAt: now }).run();
    const output = execFileSync(process.execPath, ['scripts/backup.mjs'], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' }).trim();
    const files = readdirSync(join(dir, 'backups'));
    expect(files.length).toBe(1);
    const copy = new Database(output, { readonly: true });
    expect(copy.prepare('SELECT COUNT(*) AS n FROM users').get().n).toBe(1);
    copy.close();
  });

  it('reset-password atualiza o hash e revoga sessões', async () => {
    const { dir, db } = tempDb();
    const now = Date.now();
    const id = uuidv7();
    db.insert(users).values({ id, username: 'root', passwordHash: await hashPassword('senha-antiga-longa'), role: 'admin', isRoot: true, disabled: false, createdAt: now, updatedAt: now }).run();
    execFileSync(process.execPath, ['scripts/reset-password.mjs', 'root'], { env: { ...process.env, DATA_DIR: dir }, input: 'senha-nova-muito-longa\n', encoding: 'utf8' });
    const row = db.select().from(users).get()!;
    expect(await verify(row.passwordHash, 'senha-nova-muito-longa')).toBe(true);
  });
});
```

- [x] **Step 4: Rodar e verificar**

Run: `yarn test tests/integration/scripts.test.ts`
Expected: PASS.

- [x] **Step 5: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 4: Saúde real e shutdown gracioso

**Files:**
- Modify: `src/api/routes/health.ts`, `src/api/app.ts`, `src/server.ts`
- Test: `tests/integration/health-ready.test.ts`

**Interfaces:**
- Consumes: `Db`, `sql` do drizzle, `isQueuePaused`.
- Produces: `GET /healthz` → `{ status: 'ok', db: true }` ou 503; `GET /readyz` → `{ status: 'ok', paused, uptimeSec }` ou 503.

- [x] **Step 1: Atualizar `src/api/routes/health.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { AppDeps } from '../app';
import { isQueuePaused } from './queue';

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const startedAt = Date.now();
  app.get('/healthz', async (_request, reply) => {
    try {
      deps.db.run(sql`SELECT 1`);
      return { status: 'ok', db: true };
    } catch {
      return reply.code(503).send({ status: 'error', db: false });
    }
  });
  app.get('/readyz', async (_request, reply) => {
    try {
      deps.db.run(sql`SELECT 1`);
      return { status: 'ok', paused: isQueuePaused(deps.db), uptimeSec: Math.floor((Date.now() - startedAt) / 1000) };
    } catch {
      return reply.code(503).send({ status: 'error' });
    }
  });
}
```

Ajustar a assinatura em `buildApp` (já recebe `deps`).

- [x] **Step 2: Shutdown com recuperação de órfãos**

No `src/server.ts`, antes de `app.close()`:

```ts
    workers.forEach((worker) => worker.stop());
    recoverOrphans(db, 0);
```

E registrar um handler para `uncaughtException`/`unhandledRejection` que loga e encerra o processo (o restart do Docker recupera os jobs).

- [x] **Step 3: Escrever `tests/integration/health-ready.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';

describe('saúde', () => {
  it('healthz e readyz respondem', async () => {
    const { app } = await createTestApp();
    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.json()).toEqual({ status: 'ok', db: true });
    const ready = await app.inject({ method: 'GET', url: '/readyz' });
    expect(ready.json().status).toBe('ok');
    expect(typeof ready.json().uptimeSec).toBe('number');
    await app.close();
  });
});
```

- [x] **Step 4: Rodar e verificar**

Run: `yarn test tests/integration/health-ready.test.ts`
Expected: PASS.

- [x] **Step 5: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

### Task 5: Testes e endurecimento de segurança

**Files:**
- Modify: `src/logger.ts` (destino opcional para testes)
- Test: `tests/integration/security.test.ts`

**Interfaces:**
- Consumes: rotas existentes, `createLogger`, crypto, `assertSafeUrl`.
- Produces: cobertura automatizada de segredos em repouso, redaction, SSRF, RBAC e CSP.

- [ ] **Step 1: Permitir destino no logger**

Em `src/logger.ts`:

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

- [ ] **Step 2: Escrever `tests/integration/security.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';
import { saveGithubCredentials } from '../../src/github/credentials';
import { githubCredentials } from '../../src/db/schema';
import { createProfile } from '../../src/ai/profiles';
import { aiProfiles } from '../../src/db/schema';
import { createLogger } from '../../src/logger';
import { loadConfig } from '../../src/config';
import { assertSafeUrl } from '../../src/shared/url-guard';

const PAT = 'ghp_1234567890abcdefghij';

describe('segurança', () => {
  it('cifra PAT e chave de IA em repouso e nunca os devolve', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    saveGithubCredentials(deps.db, deps.encryptionKey, { login: 'bot', pat: PAT, scopes: 'repo' });
    const credRow = deps.db.select().from(githubCredentials).get()!;
    expect(credRow.patEncrypted).not.toContain(PAT);
    const profile = createProfile(deps.db, deps.encryptionKey, { name: 'p', provider: 'openai_compatible', baseUrl: 'https://p.exemplo.com/v1', model: 'm', apiKey: 'sk-super-secreta-1234567890', temperature: 0.2, maxOutputTokens: 4096, maxTurns: 20, maxTotalTokens: 200000, maxDurationSec: 600, maxFindings: 25, maxGithubCalls: 80, prePrompt: '', skillIds: [] });
    const profileRow = deps.db.select().from(aiProfiles).get()!;
    expect(profileRow.apiKeyEncrypted).not.toContain('sk-super-secreta');
    const list = await app.inject({ method: 'GET', url: '/api/ai-profiles', headers: { cookie } });
    expect(list.body).not.toContain('sk-super-secreta');
    expect(profile.hasApiKey).toBe(true);
    await app.close();
  });

  it('redige segredos nos logs', () => {
    const chunks: string[] = [];
    const logger = createLogger(loadConfig({ ...process.env, NODE_ENV: 'test' }), { write: (chunk: string) => chunks.push(chunk) } as never);
    logger.info({ token: PAT, apiKey: 'sk-secreta', password: 'senha' }, 'teste');
    const output = chunks.join('');
    expect(output).not.toContain(PAT);
    expect(output).not.toContain('sk-secreta');
    expect(output).not.toContain('senha');
  });

  it('bloqueia SSRF em URLs privadas', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data', { lookup: async () => ['169.254.169.254'] })).rejects.toThrow(/privado/);
    await expect(assertSafeUrl('http://10.0.0.5:11434', { lookup: async () => ['10.0.0.5'] })).rejects.toThrow(/privado/);
  });

  it('rbac: viewer não muta, operator não altera credenciais', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/users', headers: { cookie }, payload: { username: 'viewer1', password: 'senha-muito-longa', role: 'viewer' } });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'viewer1', password: 'senha-muito-longa' } });
    const viewerCookie = `prr_session=${login.cookies.find((c) => c.name === 'prr_session')!.value}`;
    expect((await app.inject({ method: 'POST', url: '/api/jobs', headers: { cookie: viewerCookie }, payload: { repoFullName: 'a/b', prNumber: 1 } })).statusCode).toBe(403);
    expect(created.statusCode).toBe(201);

    const operator = await app.inject({ method: 'POST', url: '/api/users', headers: { cookie }, payload: { username: 'op1', password: 'senha-muito-longa', role: 'operator' } });
    expect(operator.statusCode).toBe(201);
    const opLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'op1', password: 'senha-muito-longa' } });
    const opCookie = `prr_session=${opLogin.cookies.find((c) => c.name === 'prr_session')!.value}`;
    expect((await app.inject({ method: 'PUT', url: '/api/settings/github', headers: { cookie: opCookie }, payload: { pat: PAT } })).statusCode).toBe(403);
    await app.close();
  });

  it('envia CSP em produção', async () => {
    const { buildApp } = await import('../../src/api/app');
    const { createDb } = await import('../../src/db/client');
    const { runMigrations } = await import('../../src/db/migrate');
    const { ensureSetupToken } = await import('../../src/auth/setup');
    const { loadEncryptionKey } = await import('../../src/auth/crypto');
    const { createEventBus } = await import('../../src/events/bus');
    const config = loadConfig({ ...process.env, NODE_ENV: 'production', PUBLIC_URL: 'https://bot.exemplo.com' });
    const { db } = createDb(':memory:');
    runMigrations(db, 'drizzle');
    const deps = { db, config, logger: createLogger(config), encryptionKey: loadEncryptionKey(config.APP_ENCRYPTION_KEY), bus: createEventBus() };
    ensureSetupToken(db, deps.logger, 'token-de-setup-de-teste-123456');
    const app = await buildApp(deps);
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    await app.close();
  });
});
```

- [ ] **Step 3: Rodar e verificar**

Run: `yarn test tests/integration/security.test.ts`
Expected: PASS.

- [ ] **Step 4: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test`
Expected: todos verdes.

---

### Task 6: E2E com Playwright

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/setup-login.spec.ts`, `tests/e2e/review-detail.spec.ts`
- Modify: `package.json` (devDependency `@playwright/test`, script `e2e`)

**Interfaces:**
- Consumes: build (`yarn build`), servidor em porta 3300 com dados temporários.
- Produces: suíte E2E executável com `yarn e2e`.

- [ ] **Step 1: Configurar `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:3300' },
  webServer: {
    command: 'yarn build && node dist/server/server.js',
    url: 'http://127.0.0.1:3300/healthz',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      PORT: '3300',
      PUBLIC_URL: 'http://127.0.0.1:3300',
      DATA_DIR: process.env.E2E_DATA_DIR ?? './.e2e-data',
      APP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
      SETUP_TOKEN: 'token-de-setup-e2e-123456',
    },
  },
});
```

Adicionar ao `package.json`: `"e2e": "playwright test"` e devDependency `"@playwright/test": "^1.50.0"`.

- [ ] **Step 2: Escrever `tests/e2e/setup-login.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

test('setup, dashboard, logout e login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup/);
  await page.getByLabel('Token de setup').fill('token-de-setup-e2e-123456');
  await page.getByLabel('Usuário root').fill('root');
  await page.getByLabel('Senha').fill('senha-muito-segura');
  await page.getByLabel('Confirmação da senha').fill('senha-muito-segura');
  await page.getByRole('button', { name: 'Criar root' }).click();
  await expect(page.getByText('Dashboard')).toBeVisible();

  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel('Usuário').fill('root');
  await page.getByLabel('Senha').fill('senha-muito-segura');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText('Dashboard')).toBeVisible();
});
```

- [ ] **Step 3: Escrever `tests/e2e/review-detail.spec.ts`**

```ts
import { expect, test } from '@playwright/test';

test('detalhe da review renderiza body, diff e markdown', async ({ page }) => {
  await page.route('**/api/setup/status', (route) => route.fulfill({ json: { needsSetup: false } }));
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { id: 'u1', username: 'root', role: 'admin', isRoot: true } } }));
  await page.route('**/api/events', (route) => route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': connected\n\n' }));
  await page.route('**/api/reviews/rev1', (route) => route.fulfill({
    json: {
      review: { id: 'rev1', body: '<!-- pr-reviewer:job:j1 -->\n**Review técnico da PR #482**\n\nUm achado **crítico** com `idleExpire`.', url: 'https://github.com/acme/api/pull/482', status: 'posted', commentsPosted: 1, commentsFallback: 0, postedAt: 1 },
      job: { id: 'j1', prTitle: 'fix: valida token', prUrl: 'https://github.com/acme/api/pull/482', headSha: '9f2c1ab', status: 'succeeded', usageJson: JSON.stringify({ input: 100, output: 20, turns: 4 }) },
      findings: [{ id: 'f1', path: 'src/auth/setup.ts', endLine: 44, severity: 'critical', title: 'Token validado antes da expiração', bodyMd: 'A sessão é aceita após o `idleExpire`.', suggestionMd: '+ return undefined;', status: 'posted', snippetJson: JSON.stringify({ lines: [{ type: 'context', oldLine: 43, newLine: 43, text: '}' }, { type: 'add', oldLine: null, newLine: 44, text: 'const user = db.select();' }], targetLine: 44 }) }],
      transcript: [],
    },
  }));
  await page.goto('/reviews/rev1');
  await expect(page.getByText('Review técnico da PR #482')).toBeVisible();
  await expect(page.getByText('Token validado antes da expiração')).toBeVisible();
  await expect(page.getByText('const user = db.select();')).toBeVisible();
  await expect(page.getByText('idleExpire').first()).toBeVisible();
  await expect(page.getByText(/pr-reviewer:job/)).toHaveCount(0);
});
```

- [ ] **Step 4: Rodar e verificar**

Run: `yarn playwright install chromium` (uma vez) e `yarn e2e`
Expected: PASS nos dois testes. Usar `E2E_DATA_DIR` temporário e remover `.e2e-data` antes de rodar em CI.

- [ ] **Step 5: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test; yarn e2e`
Expected: todos verdes.

---

### Task 7: Documentação de deploy e checklist de aceite

**Files:**
- Modify: `README.md`
- Create: `docs/operations.md`
- Test: verificação manual documentada (checklist).

**Interfaces:**
- Consumes: Dockerfile, compose, scripts, variáveis de ambiente.
- Produces: guia operacional completo e checklist AC-01..AC-13.

- [ ] **Step 1: Atualizar `README.md`**

Seções obrigatórias:

- Visão geral (o que faz, telas, tema escuro).
- Instalação (compose, token de setup, proxy TLS, HSTS).
- Configuração (GitHub PAT fine-grained/classic, perfis de IA, skills, webhooks).
- Operação: pausar fila, cancelar/reprocessar, nova execução (força).
- Backup: `docker compose exec app node scripts/backup.mjs`; copiar `data/backups` para fora.
- Reset de senha: `docker compose exec app node scripts/reset-password.mjs <username>`.
- Upgrade: backup, `docker compose pull/build`, `up`.
- Segurança: chave de criptografia, perda da chave, allowlist de URLs privadas, aviso de envio de código ao provedor.
- Limitações da v1 (fora de escopo).

- [ ] **Step 2: Criar `docs/operations.md`**

Conteúdo mínimo:

- Arquitetura de processo (um container, SQLite, worker interno, concorrência 1–3).
- Fluxo de um job (polling → fila → agente → publicação) com eventos.
- Runbook de falhas: 401/403 (PAT), 429 (rate limit), 5xx do provedor, 422 na publicação, disco cheio, backup/restore.
- Tabela de variáveis de ambiente (incluindo `SETUP_TOKEN` e `ALLOW_PRIVATE_URLS`).
- Procedimento de restore: parar container, restaurar arquivo do backup, subir.
- Build multi-arquitetura: `docker buildx build --platform linux/amd64,linux/arm64 -t review-bot:latest .`.

- [ ] **Step 3: Checklist de aceite (documento)**

Copiar os critérios AC-01..AC-13 do spec para `docs/operations.md` com passos de verificação manuais, incluindo:

- AC-01 setup/token; AC-03 review publicada; AC-05 retry; AC-06 fallback 422; AC-07 pausa por auth; AC-08 RBAC; AC-09 segredos; AC-10 retenção; AC-11 cancelamento; AC-12 PR sem achados; AC-13 força/nova execução.

- [ ] **Step 4: Verificar**

Run: `docker compose config` (com `.env` preenchido) e revisar links/ comandos do README.
Expected: compose válido; comandos existentes (`scripts/backup.mjs`, `scripts/reset-password.mjs`, `docker compose exec`).

- [ ] **Step 5: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test; yarn build`
Expected: todos verdes.

---

### Task 8: Dashboard operacional e conformidade visual

**Files:**
- Modify: `src/api/routes/dashboard.ts`, `src/web/pages/Dashboard.tsx`, `src/web/components/ui.tsx`, `src/web/pages/Reviews.tsx`, `src/web/pages/Queue.tsx`, `src/web/pages/ReviewDetail.tsx`, `src/web/pages/settings/Github.tsx`, `src/web/pages/settings/Profiles.tsx`, `src/web/pages/settings/Skills.tsx`, `src/web/pages/Setup.tsx`, `src/web/pages/Login.tsx`, `src/api/routes/jobs-read.ts`, `src/api/routes/reviews.ts`
- Create: `src/web/format.ts`
- Test: `tests/integration/dashboard-live.test.ts`, `tests/web/dashboard.test.tsx`, `tests/web/reviews.test.tsx`, `tests/web/queue.test.tsx`, `tests/web/review-detail.test.tsx`

**Interfaces:**
- Consumes: `jobs`, `reviews`, `reviewFindings`, `repositories`, `events`, `webhookDeliveries`, `githubCredentials`, `aiProfiles`, `getSystemSettings`, `isQueuePaused`.
- Produces: `GET /api/dashboard` com o payload abaixo; `GET /api/reviews` com `repoFullName`, `prNumber`, `prTitle`, contagens de severidade e filtros; `GET /api/reviews/:id` com `repository`, `events` (timeline) e `profile`; helpers `formatRelativeTime`, `formatDuration`, `formatTokens`, `formatPercent`; componentes `PageHeader`, `StatCard`, `StatusBadge` em `components/ui.tsx`.

```ts
export type DashboardData = {
  queue: { queued: number; running: number; paused: boolean; concurrency: number };
  reviews: { total: number; last24h: number; last7d: number };
  failures: number;
  failuresLast7d: number;
  failureRate7d: number;
  tokens: { input: number; output: number; last7dInput: number; last7dOutput: number };
  avgDurationSec7d: number | null;
  current: { id: string; prNumber: number; prTitle: string; prUrl: string; repoFullName: string; queuedAt: number; startedAt: number | null } | null;
  liveQueue: Array<{ id: string; prNumber: number; prTitle: string; prUrl: string; repoFullName: string; status: 'queued' | 'running'; queuedAt: number; startedAt: number | null }>;
  recentReviews: Array<{ id: string; jobId: string; prNumber: number; prTitle: string; repoFullName: string; status: string; commentsPosted: number; postedAt: number | null; critical: number; medium: number; suggestion: number }>;
  findings: { critical: number; medium: number; suggestion: number; strength: number; total: number; topRepositories: Array<{ fullName: string; count: number }> };
  trends: Array<{ date: string; reviews: number; failures: number; tokens: number }>;
  health: { pollerPaused: boolean; queuePaused: boolean; pollAuthFailures: number; lastPollAt: number | null; webhookFailures24h: number };
  onboarding: { githubConfigured: boolean; activeProfile: boolean; pollingEnabled: boolean };
};
```

**Regras visuais:** manter a paleta opencode (`--bg`, `--surface`, `--border`, etc.) e usar `design/review-bot-mockups.figcraft` apenas como referência de estrutura, espaçamento, hierarquia, estados e componentes. Nenhuma dependência nova de gráficos; as tendências usam barras proporcionais em CSS.

- [ ] **Step 1: Escrever os testes de integração do dashboard (RED)**

Em `tests/integration/dashboard-live.test.ts`, cobrir:
- fila com `paused` e `concurrency` (configuração do sistema);
- `current` e `liveQueue` com `repoFullName`;
- `recentReviews` com contagens `critical`, `medium`, `suggestion`;
- `findings` por severidade e `topRepositories`;
- `trends` com 7 posições, incluindo dias sem atividade;
- `health` com `lastPollAt` vindo de `events` e `webhookFailures24h`;
- `onboarding` refletindo credencial GitHub e perfil ativo;
- `failureRate7d` e `avgDurationSec7d` calculados de `jobs.finishedAt`/`startedAt`.

Run: `bun run test tests/integration/dashboard-live.test.ts`
Expected: FAIL pelas novas propriedades ausentes.

- [ ] **Step 2: Implementar o payload do dashboard (GREEN)**

Em `src/api/routes/dashboard.ts`, fazer consultas agregadas com joins (`jobs`+`repositories`, `reviews`+`jobs`, `reviewFindings`+`jobs`+`repositories`) e montar o payload. Reutilizar `parseTokenUsage` para tokens totais e da janela de 7 dias. `lastPollAt` é o maior `events.createdAt` com `type = 'poll.updated'`. `pollingEnabled` é `githubConfigured && activeProfile`.

Run: `bun run test tests/integration/dashboard-live.test.ts`
Expected: PASS.

- [ ] **Step 3: Criar helpers e primitivas de UI**

Em `src/web/format.ts`, implementar `formatRelativeTime(epochMs, now?)`, `formatDuration(seconds)`, `formatTokens(value)` e `formatPercent(value)` (pt-BR, sem dependências). Em `src/web/components/ui.tsx`, adicionar:
- `PageHeader({ title, subtitle, actions })`;
- `StatCard({ label, value, hint, tone, href })`;
- `StatusBadge({ status, kind })` para jobs/reviews (`Na fila`, `Em execução`, `Concluída`, `Parcial`, `Falhou`, `Cancelada`, `Fallback`).

- [ ] **Step 4: Reconstruir o Dashboard**

Estrutura obrigatória:
1. `PageHeader` com botão **Atualizar** (`refetch`) e indicador de atualização.
2. Quatro `StatCard`: Na fila (com concorrência), Em execução (PR atual), Reviews 24 h, Falhas (com falhas em 7 dias).
3. Quatro cards secundários: Tokens 7 dias, Duração média 7 dias, Taxa de falha 7 dias, Achados por severidade.
4. Grid principal: Execução atual; Fila ao vivo (até 6, link para `/queue`); Reviews recentes (5, link para `/reviews`); Saúde operacional; Consumo e tendências (7 barras CSS); Primeiros passos (somente admin e se `onboarding` tiver pendência).
5. Estados de carregamento, erro e vazio em cada seção; responsivo (uma coluna no mobile).
6. `useEvents` invalidando `['dashboard']`; nenhuma chamada nova no cliente além do endpoint do dashboard.

- [ ] **Step 5: Conformidade das demais telas com os mockups**

- **Reviews:** filtros de repositório, status, severidade e período; colunas PR/repo/status/achados/comentários/publicado; selos de status; botão **Atualizar**. Estender `GET /api/reviews` com join em `jobs`/`repositories` e contagem de severidade, mantendo paginação.
- **Fila:** cards de fila/execução/concorrência; botões **Pausar/Retomar** e **Enfileirar PR** no topo; campo único aceitando URL ou `owner/repo#número`; tabela com PR/repo/status/tentativas/posição/ações; **Cancelar**, **Reprocessar** e **Nova execução** (forçar).
- **Detalhe da review:** link **← Reviews**; cabeçalho com status, perfil/modelo, duração, tokens e comentários; corpo do review; achados agrupados por arquivo; coluna lateral com execução, perfil, chamadas GitHub, timeline (`events`) e transcrição.
- **Definições GitHub:** banner de conexão com login, token mascarado e data de validação; checklist de permissões a partir de `scopes`.
- **Definições IA/Skills:** manter comportamento; alinhar lista de perfis, ativação/teste/edição, skills ordenáveis e pré-prompt ao layout do mockup.
- **Setup/Login:** ajustar largura, espaçamento e tipografia ao mockup, mantendo a paleta opencode.
- **Onboarding:** o card **Primeiros passos** entra no dashboard; a tela dedicada permanece no Plano 4.

- [ ] **Step 6: Testes web**

Criar `tests/web/dashboard.test.tsx` cobrindo cards, fila ao vivo, reviews recentes, saúde, tendências e card de primeiros passos (admin). Atualizar `tests/web/reviews.test.tsx`, `tests/web/queue.test.tsx` e `tests/web/review-detail.test.tsx` para os novos rótulos/colunas, sem depender de snapshots frágeis.

Run: `bun run test tests/web/dashboard.test.tsx tests/web/reviews.test.tsx tests/web/queue.test.tsx tests/web/review-detail.test.tsx`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run: `bun run typecheck; bun run lint; bun run test; bun run build`
Expected: todos verdes.

---

### Task 9: Verificação final do Plano 3

**Files:**
- Nenhum arquivo novo.

- [ ] **Step 1: Rodar tudo**

Run: `bun run typecheck; bun run lint; bun run test; bun run build; bun run e2e`
Expected: tudo verde; build gera `dist/web` e `dist/server/server.js`.

- [ ] **Step 2: Verificar o container**

Run: `docker compose config` e, se Docker estiver disponível, `docker compose build`.
Expected: imagem construída; healthcheck definido; volume `data` montado em `/data`.

- [ ] **Step 3: Conferir a cobertura final do spec**

| Requisito | Onde |
|---|---|
| RF-22 retenção | Task 2 |
| RNF-07 operabilidade (backup/reset) | Task 3 |
| RNF-05 robustez (shutdown/órfãos) | Task 4 |
| RNF-01 segurança (testes) | Task 5 |
| Fork e `ALLOW_PRIVATE_URLS` | Task 1 |
| RF-16 dashboard operacional e UI/UX | Task 8 |
| E2E e aceite | Tasks 6, 7 |
| AC-01..AC-13 | `docs/operations.md` |

- [ ] **Step 4: Encerrar com o checklist de aceite**

Executar manualmente o checklist em um VPS/repositório de teste, registrar data e resultado. Sem esse passo, a v1 não é considerada pronta para produção.

