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

export function resolveSession(db: Db, token: string): { user: PublicUser } | undefined {
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
  return { user: { id: user.id, username: user.username, role: user.role, isRoot: user.isRoot } };
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

export function setSessionCookie(reply: FastifyReply, token: string, config: Config): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction && (config.PUBLIC_URL?.startsWith('https://') ?? false),
    maxAge: Math.floor(IDLE_MS / 1000),
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
import type { FastifyRequest } from 'fastify';
import { AppError } from '../api/errors';
import type { AppDeps } from '../api/app';
import { SESSION_COOKIE, resolveSession } from './sessions';

export function requireAuth(deps: AppDeps) {
  return async (request: FastifyRequest): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      throw new AppError('Autenticação necessária', 'unauthenticated', 401);
    }
    const resolved = resolveSession(deps.db, token);
    if (!resolved) {
      throw new AppError('Sessão inválida ou expirada', 'invalid_session', 401);
    }
    request.user = resolved.user;
    request.sessionToken = token;
  };
}

export function requireRole(deps: AppDeps, ...roles: Array<'admin' | 'operator' | 'viewer'>) {
  const auth = requireAuth(deps);
  return async (request: FastifyRequest): Promise<void> => {
    await auth(request);
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
  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (request: FastifyRequest) => `${request.ip}:${(request.body as { username?: string } | undefined)?.username ?? ''}` } } }, async (request, reply) => {
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
