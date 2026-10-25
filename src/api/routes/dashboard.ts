import type { FastifyInstance } from 'fastify';
import { count, eq, gte } from 'drizzle-orm';
import type { AppDeps } from '../app';
import { jobs, reviews } from '../../db/schema';
import { requireRole } from '../../auth/guards';

const DAY_MS = 24 * 60 * 60 * 1000;

function tokenValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function parseTokenUsage(usageJson: string | null): { input: number; output: number } {
  if (!usageJson) {
    return { input: 0, output: 0 };
  }
  try {
    const parsed: unknown = JSON.parse(usageJson);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { input: 0, output: 0 };
    }
    const usage = parsed as Record<string, unknown>;
    return { input: tokenValue(usage.input), output: tokenValue(usage.output) };
  } catch {
    return { input: 0, output: 0 };
  }
}

export function registerDashboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/dashboard', { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') }, async () => {
    const queued = deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'queued')).get()?.value ?? 0;
    const running = deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'running')).get()?.value ?? 0;
    const failed = deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'failed')).get()?.value ?? 0;
    const reviewsTotal = deps.db.select({ value: count() }).from(reviews).get()?.value ?? 0;
    const now = Date.now();
    const reviewsLast24h = deps.db.select({ value: count() }).from(reviews).where(gte(reviews.postedAt, now - DAY_MS)).get()?.value ?? 0;
    const reviewsLast7d = deps.db.select({ value: count() }).from(reviews).where(gte(reviews.postedAt, now - 7 * DAY_MS)).get()?.value ?? 0;
    let input = 0;
    let output = 0;
    for (const row of deps.db.select({ usageJson: jobs.usageJson }).from(jobs).all()) {
      const usage = parseTokenUsage(row.usageJson);
      input += usage.input;
      output += usage.output;
    }
    return {
      queue: { queued, running },
      reviews: { total: reviewsTotal, last24h: reviewsLast24h, last7d: reviewsLast7d },
      failures: failed,
      tokens: { input, output },
    };
  });
}
