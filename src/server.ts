import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config";
import { createLogger } from "./logger";
import { createDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { loadEncryptionKey } from "./auth/crypto";
import { purgeExpiredSessions } from "./auth/sessions";
import { ensureSetupToken } from "./auth/setup";
import { createEventBus } from "./events/bus";
import { buildApp, type AppDeps } from "./api/app";
import { getSystemSettings } from "./api/routes/settings-system";
import { GitHubError } from "./github/client";
import { pollOnce, recordPollAuthFailure } from "./github/poller";
import { createWorker } from "./jobs/worker";
import { executeJob } from "./jobs/execute";
import { recoverOrphans } from "./jobs/queue";
import { runRetention } from "./ops/retention";
import "dotenv/config";

export type RuntimeDeps = AppDeps & { fetchImpl?: typeof fetch };

export function startRuntime(deps: RuntimeDeps): { stop: () => void } {
  const settings = getSystemSettings(deps.db);
  const workerDeps = {
    db: deps.db,
    bus: deps.bus,
    logger: deps.logger,
    encryptionKey: deps.encryptionKey,
    fetchImpl: deps.fetchImpl,
    handler: executeJob,
    allowPrivate: deps.config.ALLOW_PRIVATE_URLS,
  };
  recoverOrphans(deps.db, 0);
  const workers = Array.from({ length: settings.concurrency }, (_, index) => {
    const worker = createWorker(workerDeps, `w${index + 1}`);
    worker.start();
    return worker;
  });

  let polling = false;
  let stopped = false;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  const poll = async (): Promise<void> => {
    if (polling || stopped) {
      return;
    }
    polling = true;
    try {
      await pollOnce({
        db: deps.db,
        bus: deps.bus,
        logger: deps.logger,
        encryptionKey: deps.encryptionKey,
        allowPrivate: deps.config.ALLOW_PRIVATE_URLS,
        fetchImpl: deps.fetchImpl,
      });
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 401 || error.status === 403) && !error.retryable) {
        try {
          await recordPollAuthFailure({
            db: deps.db,
            bus: deps.bus,
            logger: deps.logger,
            encryptionKey: deps.encryptionKey,
            allowPrivate: deps.config.ALLOW_PRIVATE_URLS,
            fetchImpl: deps.fetchImpl,
          });
        } catch (failure) {
          deps.logger.warn({ err: failure }, "falha ao registrar falha de autenticação no polling");
        }
      } else {
        deps.logger.warn({ err: error }, "falha no polling");
      }
    } finally {
      polling = false;
    }
  };

  const scheduleNextPoll = (): void => {
    if (stopped) {
      return;
    }
    try {
      const intervalSec = getSystemSettings(deps.db).pollingIntervalSec;
      pollTimer = setTimeout(() => {
        void poll()
          .catch((error) => deps.logger.warn({ err: error }, "falha no ciclo de polling"))
          .finally(scheduleNextPoll);
      }, intervalSec * 1000);
      pollTimer.unref?.();
    } catch (error) {
      deps.logger.warn({ err: error }, "falha ao agendar o próximo polling");
    }
  };
  scheduleNextPoll();

  const retentionTimer = setInterval(() => {
    try {
      const removed = runRetention(deps.db);
      deps.logger.info({ removed }, "retenção executada");
    } catch (error) {
      deps.logger.warn({ err: error }, "falha na retenção");
    }
  }, 24 * 60 * 60 * 1000);
  retentionTimer.unref?.();

  return {
    stop() {
      stopped = true;
      if (pollTimer) {
        clearTimeout(pollTimer);
      }
      clearInterval(retentionTimer);
      for (const worker of workers) {
        worker.stop();
      }
      recoverOrphans(deps.db, 0);
    },
  };
}

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  mkdirSync(config.DATA_DIR, { recursive: true });
  const { db } = createDb(join(config.DATA_DIR, "review-bot.db"));
  runMigrations(db, join(process.cwd(), "drizzle"));
  const encryptionKey = loadEncryptionKey(config.APP_ENCRYPTION_KEY);
  ensureSetupToken(db, logger, config.SETUP_TOKEN);
  purgeExpiredSessions(db);
  const purgeTimer = setInterval(() => purgeExpiredSessions(db), 24 * 60 * 60 * 1000);
  purgeTimer.unref();
  const bus = createEventBus();
  const app = await buildApp({ db, config, logger, encryptionKey, bus });
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
  const runtime = startRuntime({ db, config, logger, encryptionKey, bus });
  logger.info({ port: config.PORT }, "review-bot iniciado");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "encerrando");
    runtime.stop();
    clearInterval(purgeTimer);
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
