import type { Logger } from 'pino';
import { v7 as uuidv7 } from 'uuid';
import { ProviderError, type ChatInput, type ChatResult } from '../ai/adapters/types';
import type { Db } from '../db/client';
import { events } from '../db/schema';
import type { EventBus } from '../events/bus';
import { GitHubError } from '../github/client';
import type { LookupFn } from '../shared/url-guard';
import { dispatchEvent } from '../webhooks/dispatcher';
import {
  RETRY_DELAYS_MS,
  RetryableJobError,
  StaleClaimError,
  claimNextJob,
  isJobCancelled,
  markJobFinished,
  scheduleRetry,
  type JobRow,
} from './queue';

export class CancelledError extends Error {}

export type WorkerDeps = {
  db: Db;
  bus: EventBus;
  logger: Logger;
  encryptionKey: Buffer;
  fetchImpl?: typeof fetch;
  chatImpl?: (input: ChatInput) => Promise<ChatResult>;
  handler: (job: JobRow, deps: WorkerDeps) => Promise<{ status: 'succeeded' | 'partial'; usageJson?: string }>;
  now?: () => number;
  allowPrivate?: boolean;
  lookup?: LookupFn;
};

function emit(deps: WorkerDeps, jobId: string, type: string, message: string, data?: unknown): void {
  const now = (deps.now ?? Date.now)();
  const payload = typeof data === 'object' && data !== null ? data : {};
  deps.db
    .insert(events)
    .values({ id: uuidv7(), jobId, level: 'info', type, message, dataJson: data === undefined ? null : JSON.stringify(data), createdAt: now })
    .run();
  deps.bus.publish({ type, data: { jobId, ...payload }, at: now });
}

export function createWorker(deps: WorkerDeps, workerId: string): { tick: () => Promise<boolean>; start: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  const clock = deps.now ?? Date.now;

  async function tick(): Promise<boolean> {
    if (running) {
      return false;
    }
    const job = claimNextJob(deps.db, workerId, clock());
    if (!job) {
      return false;
    }
    running = true;
    try {
      emit(deps, job.id, 'job.started', `Execução iniciada (tentativa ${job.attempts})`);
      const result = await deps.handler(job, deps);
      if (isJobCancelled(deps.db, job.id)) {
        return true;
      }
      markJobFinished(deps.db, job.id, { status: result.status, usageJson: result.usageJson, now: clock(), workerId });
      emit(deps, job.id, 'job.finished', result.status === 'partial' ? 'Review parcial publicada' : 'Review publicada', { status: result.status });
    } catch (error) {
      if (error instanceof CancelledError) {
        markJobFinished(deps.db, job.id, { status: 'cancelled', now: clock(), workerId });
        emit(deps, job.id, 'job.finished', 'Job cancelado', { status: 'cancelled' });
        return true;
      }
      if (error instanceof StaleClaimError || isJobCancelled(deps.db, job.id)) {
        return true;
      }
      const retryable =
        error instanceof RetryableJobError ||
        (error instanceof GitHubError && error.retryable) ||
        (error instanceof ProviderError && error.retryable);
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      const code =
        error instanceof RetryableJobError
          ? 'retryable'
          : error instanceof GitHubError
            ? `github_${error.status}`
            : error instanceof ProviderError
              ? 'provider_error'
              : 'internal_error';
      if (retryable && job.attempts < job.maxAttempts) {
        const retryAfterMs =
          error instanceof RetryableJobError
            ? error.retryAfterMs
            : error instanceof GitHubError
              ? error.retryAfterMs
              : undefined;
        const delay = retryAfterMs !== undefined ? retryAfterMs : RETRY_DELAYS_MS[Math.min(job.attempts - 1, RETRY_DELAYS_MS.length - 1)]!;
        scheduleRetry(deps.db, job.id, delay, code, message, clock(), workerId);
        emit(deps, job.id, 'job.retry_scheduled', `Nova tentativa em ${Math.round(delay / 1000)}s`, { attempt: job.attempts, code });
      } else {
        markJobFinished(deps.db, job.id, { status: 'failed', errorCode: code, errorMessage: message, now: clock(), workerId });
        emit(deps, job.id, 'job.failed', `Falha: ${message}`, { code });
        deps.bus.publish({ type: 'job.failed.webhook', data: { jobId: job.id, code, message }, at: clock() });
        try {
          await dispatchEvent(
            {
              db: deps.db,
              encryptionKey: deps.encryptionKey,
              allowPrivate: deps.allowPrivate ?? false,
              fetchImpl: deps.fetchImpl,
            },
            'job.failed',
            { jobId: job.id, code, message },
          );
        } catch (dispatchError) {
          deps.logger.warn({ err: dispatchError }, 'falha ao disparar webhook job.failed');
        }
      }
    } finally {
      running = false;
    }
    return true;
  }

  return {
    tick,
    start() {
      timer = setInterval(() => void tick(), 2000);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
      }
    },
  };
}
