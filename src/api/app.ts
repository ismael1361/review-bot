import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import type { Logger } from 'pino';
import { AppError, errorBody } from './errors';
import { registerSecurityPlugin } from './plugins/security';
import { registerHealthRoutes } from './routes/health';
import { registerAuthRoutes } from './routes/auth';
import { registerSetupRoutes } from './routes/setup';
import { registerUserRoutes } from './routes/users';
import { registerGithubSettingsRoutes } from './routes/settings-github';
import { registerAiProfileRoutes } from './routes/ai-profiles';
import { registerSkillRoutes } from './routes/skills';
import { registerWebhookRoutes } from './routes/webhooks';
import { registerRepositoryRoutes } from './routes/repositories';
import { registerJobReadRoutes } from './routes/jobs-read';
import { registerQueueRoutes } from './routes/queue';
import { registerSystemSettingsRoutes } from './routes/settings-system';
import { registerDashboardRoutes } from './routes/dashboard';
import { registerEventRoutes } from './routes/events';
import { registerAuditRoutes } from './routes/audit';
import type { EventBus } from '../events/bus';

export type AppDeps = {
  db: Db;
  config: Config;
  logger: Logger;
  encryptionKey: Buffer;
  bus: EventBus;
};

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const logger: FastifyBaseLogger = deps.logger;
  const app = Fastify({ loggerInstance: logger, trustProxy: deps.config.TRUST_PROXY, forceCloseConnections: true });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }
    if (error instanceof ZodError) {
      return reply.code(400).send(errorBody('validation_error', 'Dados inválidos', error.issues));
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send(errorBody('rate_limited', 'Muitas tentativas, tente novamente em breve'));
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send(errorBody('bad_request', error instanceof Error ? error.message : 'Requisição inválida'));
    }
    deps.logger.error({ err: error }, 'erro não tratado');
    return reply.code(500).send(errorBody('internal_error', 'Erro interno'));
  });

  await registerSecurityPlugin(app, deps);
  registerHealthRoutes(app, deps);
  registerSetupRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerUserRoutes(app, deps);
  registerGithubSettingsRoutes(app, deps);
  registerAiProfileRoutes(app, deps);
  registerSkillRoutes(app, deps);
  registerWebhookRoutes(app, deps);
  registerRepositoryRoutes(app, deps);
  registerJobReadRoutes(app, deps);
  registerQueueRoutes(app, deps);
  registerSystemSettingsRoutes(app, deps);
  registerDashboardRoutes(app, deps);
  registerEventRoutes(app, deps);
  registerAuditRoutes(app, deps);

  const webRoot = join(process.cwd(), 'dist', 'web');
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send(errorBody('not_found', 'Rota não encontrada'));
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
