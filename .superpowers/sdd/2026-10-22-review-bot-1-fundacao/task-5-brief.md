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
  const app = Fastify({ loggerInstance: deps.logger, trustProxy: deps.config.TRUST_PROXY });

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
import { createTestApp } from '../helpers/app';

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
    const { app } = createTestApp();
    const created = await app.inject({ method: 'POST', url: '/api/setup', payload: body });
    expect(created.statusCode).toBe(201);
    const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json()).toEqual({ needsSetup: false });
    const again = await app.inject({ method: 'POST', url: '/api/setup', payload: { ...body, username: 'outro' } });
    expect(again.statusCode).toBe(409);
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
