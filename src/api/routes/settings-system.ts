import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { requireRole } from '../../auth/guards';
import { getSetting, setSetting } from '../../db/settings';
import { audit } from '../../audit/audit';

const SYSTEM_KEY = 'system';

export const SystemSettings = z.object({
  pollingIntervalSec: z.number().int().min(30).max(3600).default(60),
  retentionDays: z.number().int().min(1).max(3650).default(90),
  concurrency: z.number().int().min(1).max(3).default(1),
  ignoreDrafts: z.boolean().default(false),
  skipOwnPrs: z.boolean().default(true),
});

export type SystemSettingsType = z.infer<typeof SystemSettings>;

export function getSystemSettings(db: AppDeps['db']): SystemSettingsType {
  return SystemSettings.parse(getSetting<Partial<SystemSettingsType>>(db, SYSTEM_KEY) ?? {});
}

export function registerSystemSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const admin = requireRole(deps, 'admin');

  app.get('/api/settings/system', { preHandler: admin }, async () => ({ settings: getSystemSettings(deps.db) }));

  app.put('/api/settings/system', { preHandler: admin }, async (request) => {
    const body = SystemSettings.parse(request.body);
    setSetting(deps.db, SYSTEM_KEY, body);
    audit(deps.db, { userId: request.user?.id, action: 'system_settings.update', data: body, ip: request.ip });
    return { settings: body };
  });
}
