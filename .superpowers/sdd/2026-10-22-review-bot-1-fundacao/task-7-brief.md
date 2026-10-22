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
  return db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.disabled, false), ne(users.id, exceptId))).all().length;
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
      throw new AppError('É necessário ao menos um administrador ativo', 'last_admin', 409);
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
