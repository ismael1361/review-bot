import type { FastifyInstance } from 'fastify';
import { count, desc } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { auditLog } from '../../db/schema';
import { requireRole } from '../../auth/guards';

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function registerAuditRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/audit', { preHandler: requireRole(deps, 'admin') }, async (request) => {
    const query = ListQuery.parse(request.query);
    const entries = deps.db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit)
      .all();
    const total = deps.db.select({ value: count() }).from(auditLog).get()?.value ?? 0;
    return { entries, total };
  });
}
