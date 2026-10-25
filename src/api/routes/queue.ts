import type { FastifyInstance } from 'fastify';
import { count, eq } from 'drizzle-orm';
import type { AppDeps } from '../app';
import { jobs } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { getSetting, setSetting } from '../../db/settings';
import { getSystemSettings } from './settings-system';
import { audit } from '../../audit/audit';

const QUEUE_PAUSED_KEY = 'queue_paused';

export function isQueuePaused(db: AppDeps['db']): boolean {
  return getSetting<boolean>(db, QUEUE_PAUSED_KEY) === true;
}

export function registerQueueRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/queue', { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') }, async () => ({
    queued: deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'queued')).get()?.value ?? 0,
    running: deps.db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'running')).get()?.value ?? 0,
    paused: isQueuePaused(deps.db),
    concurrency: getSystemSettings(deps.db).concurrency,
  }));

  app.post('/api/queue/pause', { preHandler: requireRole(deps, 'operator', 'admin') }, async (request) => {
    setSetting(deps.db, QUEUE_PAUSED_KEY, true);
    audit(deps.db, { userId: request.user?.id, action: 'queue.pause', ip: request.ip });
    deps.bus.publish({ type: 'queue.updated', data: { paused: true }, at: Date.now() });
    return { paused: true };
  });

  app.post('/api/queue/resume', { preHandler: requireRole(deps, 'operator', 'admin') }, async (request) => {
    setSetting(deps.db, QUEUE_PAUSED_KEY, false);
    audit(deps.db, { userId: request.user?.id, action: 'queue.resume', ip: request.ip });
    deps.bus.publish({ type: 'queue.updated', data: { paused: false }, at: Date.now() });
    return { paused: false };
  });
}
