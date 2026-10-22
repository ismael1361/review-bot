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
