import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { completeSetup, getSetupTokenForDisplay, isSetupComplete } from '../../auth/setup';
import { createSession, setSessionCookie } from '../../auth/sessions';

const SetupBody = z.object({
  token: z.string().min(1),
  username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(12).max(200),
});

export function registerSetupRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/setup/status', async () => {
    if (isSetupComplete(deps.db)) {
      return { needsSetup: false };
    }
    const envToken = deps.config.SETUP_TOKEN?.trim();
    return {
      needsSetup: true,
      tokenSource: envToken ? ('env' as const) : ('generated' as const),
      setupToken: envToken ? undefined : getSetupTokenForDisplay(),
    };
  });

  app.post('/api/setup', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const body = SetupBody.parse(request.body);
    const result = await completeSetup(deps.db, body);
    const { token } = createSession(deps.db, result.userId, { ip: request.ip, userAgent: request.headers['user-agent'] });
    setSessionCookie(reply, token, deps.config);
    deps.logger.info({ userId: result.userId }, 'root criado');
    return reply.code(201).send({ userId: result.userId });
  });
}
