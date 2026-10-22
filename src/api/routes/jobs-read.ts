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
