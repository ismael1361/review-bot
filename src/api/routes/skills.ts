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
