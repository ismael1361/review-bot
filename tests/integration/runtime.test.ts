import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../../src/db/client';
import { jobs, repositories } from '../../src/db/schema';
import { getSystemSettings } from '../../src/api/routes/settings-system';
import { setSetting } from '../../src/db/settings';
import { GitHubError } from '../../src/github/client';
import { createTestDeps } from '../helpers/app';
import { createRuntimeWorkerDeps, startRuntime } from '../../src/server';

const poller = vi.hoisted(() => ({
  pollOnce: vi.fn(),
  recordPollAuthFailure: vi.fn(),
  clearPollAuthFailures: vi.fn(),
}));

vi.mock('../../src/github/poller', () => ({
  pollOnce: poller.pollOnce,
  recordPollAuthFailure: poller.recordPollAuthFailure,
  clearPollAuthFailures: poller.clearPollAuthFailures,
}));

function insertRepo(db: Db): void {
  const now = Date.now();
  db.insert(repositories)
    .values({
      id: 'r1',
      githubId: '1',
      owner: 'a',
      name: 'b',
      fullName: 'a/b',
      private: false,
      archived: false,
      enabled: true,
      discoveredAt: now,
      updatedAt: now,
    })
    .run();
}

function insertJob(db: Db, status: 'queued' | 'running', lockedBy: string | null): string {
  const now = Date.now();
  const id = uuidv7();
  db.insert(jobs)
    .values({
      id,
      repositoryId: 'r1',
      prNumber: 1,
      prTitle: 't',
      prUrl: 'u',
      authorLogin: 'x',
      headSha: uuidv7(),
      baseSha: 'b',
      runSeq: 1,
      status,
      priority: 0,
      attempts: status === 'running' ? 1 : 0,
      maxAttempts: 3,
      queuedAt: now,
      nextAttemptAt: now,
      heartbeatAt: status === 'running' ? now : null,
      lockedBy,
    })
    .run();
  return id;
}

function getJob(db: Db, id: string) {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()!;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  poller.pollOnce.mockReset();
  poller.recordPollAuthFailure.mockReset();
  poller.clearPollAuthFailures.mockReset();
});

describe('runtime', () => {
  it('worker lê ALLOW_PRIVATE_URLS do config em tempo de execução', () => {
    const deps = createTestDeps();
    deps.config.ALLOW_PRIVATE_URLS = false;
    const workerDeps = createRuntimeWorkerDeps(deps);
    expect(workerDeps.allowPrivate).toBe(false);
    deps.config.ALLOW_PRIVATE_URLS = true;
    expect(workerDeps.allowPrivate).toBe(true);
  });

  it('recupera jobs running no start e no stop', () => {
    const deps = createTestDeps();
    insertRepo(deps.db);
    const starting = insertJob(deps.db, 'running', 'w-antigo');

    const runtime = startRuntime(deps);
    expect(getJob(deps.db, starting).status).toBe('queued');

    const stopping = insertJob(deps.db, 'running', 'w-novo');
    runtime.stop();
    expect(getJob(deps.db, stopping).status).toBe('queued');
  });

  it('relê pollingIntervalSec a cada ciclo e não limpa as falhas de autenticação em runtime', async () => {
    vi.useFakeTimers();
    const deps = createTestDeps();
    setSetting(deps.db, 'system', { pollingIntervalSec: 30 });
    let calls = 0;
    poller.pollOnce.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        setSetting(deps.db, 'system', { ...getSystemSettings(deps.db), pollingIntervalSec: 60 });
      }
      return { found: 0, enqueued: 0, skipped: 0 };
    });

    const runtime = startRuntime(deps);
    try {
      await vi.advanceTimersByTimeAsync(29_999);
      expect(poller.pollOnce).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(poller.pollOnce).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(poller.pollOnce).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(poller.pollOnce).toHaveBeenCalledTimes(2);
      expect(poller.clearPollAuthFailures).not.toHaveBeenCalled();
    } finally {
      runtime.stop();
    }
  });

  it('isola falha ao registrar falha de autenticação no polling', async () => {
    vi.useFakeTimers();
    const deps = createTestDeps();
    setSetting(deps.db, 'system', { pollingIntervalSec: 30 });
    poller.pollOnce.mockRejectedValue(new GitHubError('credencial inválida', 401, false, ''));
    poller.recordPollAuthFailure.mockRejectedValue(new Error('registro indisponível'));
    const warn = vi.spyOn(deps.logger, 'warn');

    const runtime = startRuntime(deps);
    try {
      await vi.advanceTimersByTimeAsync(30_000);
      expect(poller.recordPollAuthFailure).toHaveBeenCalledTimes(1);
      expect(
        warn.mock.calls.some((call) => call[1] === 'falha ao registrar falha de autenticação no polling'),
      ).toBe(true);
    } finally {
      runtime.stop();
    }
  });
});
