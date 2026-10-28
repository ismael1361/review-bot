import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../src/api/app';
import { loadConfig } from '../../src/config';
import { createTestDb } from './db';
import { createLogger } from '../../src/logger';
import { loadEncryptionKey } from '../../src/auth/crypto';
import { ensureSetupToken } from '../../src/auth/setup';
import { createEventBus } from '../../src/events/bus';
import { SETUP_TOKEN } from './auth';

export function createTestDeps(): AppDeps {
  const config = loadConfig({ ...process.env, NODE_ENV: 'test' });
  return {
    db: createTestDb(),
    config,
    logger: createLogger(config),
    encryptionKey: loadEncryptionKey(process.env.APP_ENCRYPTION_KEY ?? ''),
    bus: createEventBus(),
  };
}

export async function createTestApp(): Promise<{ app: FastifyInstance; deps: AppDeps }> {
  const deps = createTestDeps();
  ensureSetupToken(deps.db, deps.logger, SETUP_TOKEN);
  deps.config.SETUP_TOKEN = SETUP_TOKEN;
  return { app: await buildApp(deps), deps };
}
