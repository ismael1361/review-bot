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
      await assertSafeUrl(webhook.url, { allowPrivate: deps.allowPrivate });
      const response = await (deps.fetchImpl ?? fetch)(webhook.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-prreviewer-event': event,
          'x-prreviewer-signature': `sha256=${signPayload(secret, body)}`,
        },
        body,
      });
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
