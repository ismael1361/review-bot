import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app';
import { requireRole } from '../../auth/guards';
import { audit } from '../../audit/audit';
import {
  InstanceSettings,
  applyInstanceSettings,
  effectiveTrustProxy,
  getInstanceSettings,
  saveInstanceSettings,
} from '../../instance/settings';

export function registerInstanceSettingsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const admin = requireRole(deps, 'admin');

  app.get('/api/settings/instance', { preHandler: admin }, async () => {
    const settings = getInstanceSettings(deps.db);
    return {
      settings,
      restartRequired: effectiveTrustProxy(settings, process.env) !== deps.config.TRUST_PROXY,
    };
  });

  app.put('/api/settings/instance', { preHandler: admin }, async (request) => {
    const settings = saveInstanceSettings(deps.db, InstanceSettings.parse(request.body));
    const { trustProxyChanged } = applyInstanceSettings(deps.config, settings, process.env);
    audit(deps.db, { userId: request.user?.id, action: 'instance_settings.update', data: settings, ip: request.ip });
    return { settings, restartRequired: trustProxyChanged };
  });
}
