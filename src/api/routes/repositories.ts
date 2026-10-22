import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { AppError } from '../errors';
import { repositories } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { audit } from '../../audit/audit';

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
    audit(deps.db, { userId: request.user?.id, action: 'repository.update', targetType: 'repository', targetId: id, data: { enabled }, ip: request.ip });
    return { repository: deps.db.select().from(repositories).where(eq(repositories.id, id)).get() };
  });
}
