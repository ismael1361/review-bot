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
