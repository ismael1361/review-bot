import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { loadEncryptionKey } from './auth/crypto';
import { purgeExpiredSessions } from './auth/sessions';
import { ensureSetupToken } from './auth/setup';
import { createEventBus } from './events/bus';
import { buildApp } from './api/app';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  mkdirSync(config.DATA_DIR, { recursive: true });
  const { db } = createDb(join(config.DATA_DIR, 'review-bot.db'));
  runMigrations(db, join(process.cwd(), 'drizzle'));
  const encryptionKey = loadEncryptionKey(config.APP_ENCRYPTION_KEY);
  ensureSetupToken(db, logger, config.SETUP_TOKEN);
  purgeExpiredSessions(db);
  const purgeTimer = setInterval(() => purgeExpiredSessions(db), 24 * 60 * 60 * 1000);
  purgeTimer.unref();
  const app = await buildApp({ db, config, logger, encryptionKey, bus: createEventBus() });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'review-bot iniciado');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'encerrando');
    clearInterval(purgeTimer);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
