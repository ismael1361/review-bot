import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { AppDeps } from '../app';
import { isQueuePaused } from './queue';

export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  const startedAt = Date.now();
  app.get('/healthz', async (_request, reply) => {
    try {
      deps.db.run(sql`SELECT 1`);
      return { status: 'ok', db: true };
    } catch {
      return reply.code(503).send({ status: 'error', db: false });
    }
  });
  app.get('/readyz', async (_request, reply) => {
    try {
      deps.db.run(sql`SELECT 1`);
      return { status: 'ok', paused: isQueuePaused(deps.db), uptimeSec: Math.floor((Date.now() - startedAt) / 1000) };
    } catch {
      return reply.code(503).send({ status: 'error' });
    }
  });
}
