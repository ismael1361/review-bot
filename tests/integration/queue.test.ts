import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { AppDeps } from '../../src/api/app';
import { activateProfile, createProfile, type ProfileInputType } from '../../src/ai/profiles';
import type { Db } from '../../src/db/client';
import { events, jobs, prSeen, repositories } from '../../src/db/schema';
import { setSetting } from '../../src/db/settings';
import { GitHubError } from '../../src/github/client';
import { saveGithubCredentials } from '../../src/github/credentials';
import {
  RETRY_DELAYS_MS,
  RetryableJobError,
  cancelJob,
  claimNextJob,
  enqueueManual,
  heartbeat,
  isJobCancelled,
  markJobFinished,
  queueDepth,
  recoverOrphans,
  retryJob,
  scheduleRetry,
} from '../../src/jobs/queue';
import { createWorker } from '../../src/jobs/worker';
import { createTestApp } from '../helpers/app';

const TOKEN = 'ghp_1234567890abcdefghij';
const NOW = Date.parse('2026-10-22T15:00:00Z');

const repoInfo = { id: 1, full_name: 'acme/api', archived: false, private: true };
const pullInfo = {
  title: 'fix: valida token',
  html_url: 'https://github.com/acme/api/pull/482',
  draft: false,
  head: { sha: '9f2c1ab' },
  base: { sha: 'aaaaaaa' },
  user: { login: 'octocat' },
};

const PROFILE_INPUT: ProfileInputType = {
  name: 'p1',
  provider: 'openai_compatible',
  baseUrl: 'https://p.exemplo.com/v1',
  model: 'm',
  apiKey: 'k',
  temperature: 0.2,
  maxOutputTokens: 4096,
  maxTurns: 20,
  maxTotalTokens: 200000,
  maxDurationSec: 600,
  maxFindings: 25,
  maxGithubCalls: 80,
  prePrompt: '',
  skillIds: [],
};

type Route = { match: string; body?: unknown; status?: number };

function fakeFetch(routes: Route[]): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const route of routes) {
      if (url.includes(route.match)) {
        return new Response(JSON.stringify(route.body ?? {}), {
          status: route.status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
    return new Response('{}', { status: 404 });
  });
  return { fetchImpl: mock as unknown as typeof fetch, calls };
}

async function makeDeps(): Promise<AppDeps> {
  const { app, deps } = await createTestApp();
  await app.close();
  deps.db
    .insert(repositories)
    .values({
      id: 'repo1',
      githubId: '999',
      owner: 'a',
      name: 'b',
      fullName: 'a/b',
      private: false,
      archived: false,
      enabled: true,
      discoveredAt: NOW,
      updatedAt: NOW,
    })
    .run();
  return deps;
}

function insertJob(db: Db, overrides: Partial<typeof jobs.$inferInsert> = {}): string {
  const now = Date.now();
  const id = uuidv7();
  db.insert(jobs)
    .values({
      id,
      repositoryId: 'repo1',
      prNumber: 1,
      prTitle: 't',
      prUrl: 'u',
      authorLogin: 'x',
      headSha: uuidv7(),
      baseSha: 'b',
      runSeq: 1,
      status: 'queued',
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      queuedAt: now,
      nextAttemptAt: now,
      ...overrides,
    })
    .run();
  return id;
}

function getJob(db: Db, id: string) {
  return db.select().from(jobs).where(eq(jobs.id, id)).get()!;
}

function jobEventTypes(db: Db, jobId: string): string[] {
  return db
    .select()
    .from(events)
    .where(eq(events.jobId, jobId))
    .all()
    .map((event) => event.type);
}

function activateTestProfile(deps: AppDeps): string {
  const profile = createProfile(deps.db, deps.encryptionKey, PROFILE_INPUT);
  activateProfile(deps.db, profile.id);
  return profile.id;
}

describe('fila', () => {
  it('claim atômico: dois workers pegam apenas um job', async () => {
    const d = await makeDeps();
    const id = insertJob(d.db);
    const first = claimNextJob(d.db, 'w1');
    const second = claimNextJob(d.db, 'w2');
    expect(first?.id).toBe(id);
    expect(first?.status).toBe('running');
    expect(first?.attempts).toBe(1);
    expect(first?.lockedBy).toBe('w1');
    expect(second).toBeUndefined();
  });

  it('não faz claim com a fila pausada e volta a funcionar ao retomar', async () => {
    const d = await makeDeps();
    const id = insertJob(d.db);
    setSetting(d.db, 'queue_paused', true);
    expect(claimNextJob(d.db, 'w1')).toBeUndefined();
    setSetting(d.db, 'queue_paused', false);
    expect(claimNextJob(d.db, 'w1')?.id).toBe(id);
  });

  it('respeita nextAttemptAt futuro', async () => {
    const d = await makeDeps();
    const id = insertJob(d.db);
    scheduleRetry(d.db, id, RETRY_DELAYS_MS[0]!, 'retryable', 'x');
    expect(claimNextJob(d.db, 'w1')).toBeUndefined();
    expect(claimNextJob(d.db, 'w1', Date.now() + RETRY_DELAYS_MS[0]! + 1)).toBeDefined();
  });

  it('recupera job órfão pelo heartbeat antigo', async () => {
    const d = await makeDeps();
    insertJob(d.db, { status: 'running', heartbeatAt: Date.now() - 300_000, lockedBy: 'w1' });
    expect(recoverOrphans(d.db)).toBe(1);
    expect(claimNextJob(d.db, 'w2')).toBeDefined();
  });

  it('recupera job running sem heartbeat', async () => {
    const d = await makeDeps();
    insertJob(d.db, { status: 'running', heartbeatAt: null, lockedBy: 'w1' });
    expect(recoverOrphans(d.db)).toBe(1);
    expect(claimNextJob(d.db, 'w2')).toBeDefined();
  });

  it('cancela e reprocessa', async () => {
    const d = await makeDeps();
    const id = insertJob(d.db, { status: 'failed' });
    expect(cancelJob(d.db, id)).toBe(false);
    expect(retryJob(d.db, id)).toBe(true);
    expect(claimNextJob(d.db, 'w1')).toBeDefined();
  });

  it('cancelamento prevalece sobre markJobFinished e scheduleRetry', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const id = insertJob(d.db, { status: 'running', heartbeatAt: now, lockedBy: 'w1' });
    expect(cancelJob(d.db, id, now)).toBe(true);
    markJobFinished(d.db, id, { status: 'succeeded', now: now + 1 });
    expect(getJob(d.db, id).status).toBe('cancelled');
    scheduleRetry(d.db, id, 1000, 'retryable', 'x', now + 2);
    expect(getJob(d.db, id).status).toBe('cancelled');
    expect(isJobCancelled(d.db, id)).toBe(true);
  });

  it('heartbeat atualiza o timestamp e queueDepth conta por status', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const runningId = insertJob(d.db, { status: 'running', heartbeatAt: now - 10_000, lockedBy: 'w1' });
    insertJob(d.db);
    insertJob(d.db);
    heartbeat(d.db, runningId, now);
    expect(getJob(d.db, runningId).heartbeatAt).toBe(now);
    expect(queueDepth(d.db)).toEqual({ queued: 2, running: 1 });
  });
});

describe('worker', () => {
  it('tick com sucesso marca succeeded e registra eventos', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const id = insertJob(d.db, { queuedAt: now, nextAttemptAt: now });
    const handler = vi.fn(async () => ({ status: 'succeeded' as const, usageJson: '{"input":1}' }));
    const worker = createWorker({ ...d, handler, now: () => now }, 'w1');

    expect(await worker.tick()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const job = getJob(d.db, id);
    expect(job.status).toBe('succeeded');
    expect(job.attempts).toBe(1);
    expect(job.usageJson).toBe('{"input":1}');
    expect(jobEventTypes(d.db, id)).toEqual(['job.started', 'job.finished']);
    expect(await worker.tick()).toBe(false);
  });

  it('tick com erro retryable agenda nova tentativa', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const id = insertJob(d.db, { queuedAt: now, nextAttemptAt: now });
    const worker = createWorker(
      {
        ...d,
        handler: async () => {
          throw new RetryableJobError('temporario', 1000);
        },
        now: () => now,
      },
      'w1',
    );

    expect(await worker.tick()).toBe(true);
    const job = getJob(d.db, id);
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(1);
    expect(job.nextAttemptAt).toBe(now + 1000);
    expect(job.errorCode).toBe('retryable');
    expect(jobEventTypes(d.db, id)).toContain('job.retry_scheduled');
    expect(claimNextJob(d.db, 'w2', now)).toBeUndefined();
    expect(claimNextJob(d.db, 'w2', now + 1001)?.attempts).toBe(2);
  });

  it('tick respeita Retry-After de GitHubError', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const id = insertJob(d.db, { queuedAt: now, nextAttemptAt: now });
    const worker = createWorker(
      {
        ...d,
        handler: async () => {
          throw new GitHubError('rate limit', 429, true, '', 60_000);
        },
        now: () => now,
      },
      'w1',
    );

    expect(await worker.tick()).toBe(true);
    const job = getJob(d.db, id);
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(1);
    expect(job.nextAttemptAt).toBe(now + 60_000);
    expect(job.errorCode).toBe('github_429');
    expect(claimNextJob(d.db, 'w2', now + 59_999)).toBeUndefined();
    expect(claimNextJob(d.db, 'w2', now + 60_000)?.attempts).toBe(2);
  });

  it('tick com erro permanente marca failed', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const id = insertJob(d.db, { queuedAt: now, nextAttemptAt: now });
    const worker = createWorker(
      {
        ...d,
        handler: async () => {
          throw new Error('boom');
        },
        now: () => now,
      },
      'w1',
    );

    expect(await worker.tick()).toBe(true);
    const job = getJob(d.db, id);
    expect(job.status).toBe('failed');
    expect(job.errorCode).toBe('internal_error');
    expect(job.errorMessage).toBe('boom');
    expect(jobEventTypes(d.db, id)).toContain('job.failed');
  });

  it('cancelamento durante o handler não é sobrescrito pelo sucesso', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const id = insertJob(d.db, { queuedAt: now, nextAttemptAt: now });
    const worker = createWorker(
      {
        ...d,
        handler: async (job) => {
          cancelJob(d.db, job.id, now + 1);
          return { status: 'succeeded' as const };
        },
        now: () => now,
      },
      'w1',
    );

    expect(await worker.tick()).toBe(true);
    expect(getJob(d.db, id).status).toBe('cancelled');
    expect(jobEventTypes(d.db, id)).toEqual(['job.started']);
  });

  it('handler obsoleto não sobrescreve cancel seguido de retry no sucesso', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const id = insertJob(d.db, { queuedAt: now, nextAttemptAt: now });
    const worker = createWorker(
      {
        ...d,
        handler: async (job) => {
          cancelJob(d.db, job.id, now + 1);
          retryJob(d.db, job.id, now + 2);
          return { status: 'succeeded' as const };
        },
        now: () => now,
      },
      'w1',
    );

    expect(await worker.tick()).toBe(true);
    const job = getJob(d.db, id);
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
  });

  it('handler obsoleto não reagenda cancel seguido de retry na falha', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const id = insertJob(d.db, { queuedAt: now, nextAttemptAt: now });
    const worker = createWorker(
      {
        ...d,
        handler: async (job) => {
          cancelJob(d.db, job.id, now + 1);
          retryJob(d.db, job.id, now + 2);
          throw new RetryableJobError('temporario', 1000);
        },
        now: () => now,
      },
      'w1',
    );

    expect(await worker.tick()).toBe(true);
    const job = getJob(d.db, id);
    expect(job.status).toBe('queued');
    expect(job.attempts).toBe(0);
    expect(job.nextAttemptAt).toBe(now + 2);
  });

  it('cancelamento durante o handler não agenda retry', async () => {
    const d = await makeDeps();
    const now = Date.now();
    const id = insertJob(d.db, { queuedAt: now, nextAttemptAt: now });
    const worker = createWorker(
      {
        ...d,
        handler: async (job) => {
          cancelJob(d.db, job.id, now + 1);
          throw new RetryableJobError('temporario', 1000);
        },
        now: () => now,
      },
      'w1',
    );

    expect(await worker.tick()).toBe(true);
    expect(getJob(d.db, id).status).toBe('cancelled');
    expect(jobEventTypes(d.db, id)).toEqual(['job.started']);
  });
});

describe('enqueueManual', () => {
  function manualDeps(d: AppDeps, fetchImpl: typeof fetch) {
    return { db: d.db, encryptionKey: d.encryptionKey, fetchImpl };
  }

  it('cria job com perfil e snapshot, atualiza pr_seen e respeita force', async () => {
    const d = await makeDeps();
    saveGithubCredentials(d.db, d.encryptionKey, { login: 'bot', pat: TOKEN, scopes: 'repo' });
    const profileId = activateTestProfile(d);
    const { fetchImpl, calls } = fakeFetch([
      { match: '/repos/acme/api/pulls/482', body: pullInfo },
      { match: '/repos/acme/api', body: repoInfo },
    ]);

    const firstId = await enqueueManual(manualDeps(d, fetchImpl), { repoFullName: 'acme/api', prNumber: 482 });
    const first = getJob(d.db, firstId);
    expect(first.status).toBe('queued');
    expect(first.runSeq).toBe(1);
    expect(first.profileId).toBe(profileId);
    const snapshot = JSON.parse(first.profileSnapshotJson!);
    expect(snapshot).toMatchObject({ id: profileId, name: 'p1', provider: 'openai_compatible', model: 'm' });
    expect(snapshot).not.toHaveProperty('apiKey');
    expect(snapshot).not.toHaveProperty('apiKeyEncrypted');
    const repo = d.db.select().from(repositories).where(eq(repositories.fullName, 'acme/api')).get()!;
    const seen = d.db
      .select()
      .from(prSeen)
      .where(and(eq(prSeen.repositoryId, repo.id), eq(prSeen.prNumber, 482)))
      .get();
    expect(seen?.lastHeadSha).toBe(pullInfo.head.sha);

    await expect(
      enqueueManual(manualDeps(d, fetchImpl), { repoFullName: 'acme/api', prNumber: 482 }),
    ).rejects.toMatchObject({ code: 'job_exists', statusCode: 409 });

    const secondId = await enqueueManual(manualDeps(d, fetchImpl), { repoFullName: 'acme/api', prNumber: 482, force: true });
    expect(secondId).not.toBe(firstId);
    expect(getJob(d.db, secondId).runSeq).toBe(2);
    expect(d.db.select().from(jobs).all()).toHaveLength(2);
    expect(calls.filter((url) => url.includes('/pulls/482'))).toHaveLength(3);
  });

  it('sem perfil ativo retorna no_active_profile e não cria job', async () => {
    const d = await makeDeps();
    saveGithubCredentials(d.db, d.encryptionKey, { login: 'bot', pat: TOKEN, scopes: 'repo' });
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      enqueueManual(manualDeps(d, fetchImpl), { repoFullName: 'acme/api', prNumber: 482 }),
    ).rejects.toMatchObject({ code: 'no_active_profile', statusCode: 409 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(d.db.select().from(jobs).all()).toHaveLength(0);
  });
});
