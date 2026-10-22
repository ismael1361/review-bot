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
