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
