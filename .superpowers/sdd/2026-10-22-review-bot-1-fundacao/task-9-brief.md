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
