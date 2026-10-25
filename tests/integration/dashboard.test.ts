import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';
import { auditLog, jobs, repositories, reviews } from '../../src/db/schema';

describe('dashboard e fila', () => {
  it('retorna métricas zeradas e pausa/retoma', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });
    expect(dashboard.json()).toMatchObject({
      queue: { queued: 0, running: 0, paused: false, concurrency: 1 },
      reviews: { total: 0, last24h: 0, last7d: 0 },
      failures: 0,
      failuresLast7d: 0,
      failureRate7d: 0,
      tokens: { input: 0, output: 0, last7dInput: 0, last7dOutput: 0 },
      avgDurationSec7d: null,
      current: null,
      liveQueue: [],
      recentReviews: [],
      findings: { critical: 0, medium: 0, suggestion: 0, strength: 0, total: 0, topRepositories: [] },
      health: { pollerPaused: false, queuePaused: false, pollAuthFailures: 0, lastPollAt: null, webhookFailures24h: 0 },
      onboarding: { githubConfigured: false, activeProfile: false, pollingEnabled: false },
    });
    expect(dashboard.json().trends).toHaveLength(7);

    const pause = await app.inject({ method: 'POST', url: '/api/queue/pause', headers: { cookie } });
    expect(pause.json().paused).toBe(true);
    const queue = await app.inject({ method: 'GET', url: '/api/queue', headers: { cookie } });
    expect(queue.json().paused).toBe(true);
    expect(queue.json().concurrency).toBe(1);
    const resume = await app.inject({ method: 'POST', url: '/api/queue/resume', headers: { cookie } });
    expect(resume.json().paused).toBe(false);
    await app.close();
  });

  it('valida limites das configurações do sistema', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const invalid = await app.inject({ method: 'PUT', url: '/api/settings/system', headers: { cookie }, payload: { pollingIntervalSec: 5 } });
    expect(invalid.statusCode).toBe(400);
    const valid = await app.inject({ method: 'PUT', url: '/api/settings/system', headers: { cookie }, payload: { pollingIntervalSec: 120, retentionDays: 30, concurrency: 2, ignoreDrafts: true, skipOwnPrs: false } });
    expect(valid.json().settings.pollingIntervalSec).toBe(120);
    const read = await app.inject({ method: 'GET', url: '/api/settings/system', headers: { cookie } });
    expect(read.json().settings.concurrency).toBe(2);
    const queue = await app.inject({ method: 'GET', url: '/api/queue', headers: { cookie } });
    expect(queue.json().concurrency).toBe(2);
    await app.close();
  });
});

describe('repositórios, jobs e reviews', () => {
  it('lista e alterna repositórios', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    deps.db.insert(repositories).values({
      id: 'repo-1',
      githubId: '1',
      owner: 'acme',
      name: 'app',
      fullName: 'acme/app',
      private: false,
      archived: false,
      enabled: true,
      discoveredAt: 1,
      updatedAt: 1,
    }).run();

    const list = await app.inject({ method: 'GET', url: '/api/repositories', headers: { cookie } });
    expect(list.json().repositories).toHaveLength(1);

    const patched = await app.inject({ method: 'PATCH', url: '/api/repositories/repo-1', headers: { cookie }, payload: { enabled: false } });
    expect(patched.json().repository.enabled).toBe(false);

    const auditRow = deps.db.select().from(auditLog).where(eq(auditLog.action, 'repository.update')).get();
    expect(auditRow?.targetId).toBe('repo-1');
    expect(auditRow?.dataJson).toContain('"enabled":false');

    const missing = await app.inject({ method: 'PATCH', url: '/api/repositories/nope', headers: { cookie }, payload: { enabled: false } });
    expect(missing.statusCode).toBe(404);
    await app.close();
  });

  it('lista jobs e reviews com paginação', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    deps.db.insert(repositories).values({
      id: 'repo-1',
      githubId: '1',
      owner: 'acme',
      name: 'app',
      fullName: 'acme/app',
      private: false,
      archived: false,
      enabled: true,
      discoveredAt: 1,
      updatedAt: 1,
    }).run();
    deps.db.insert(jobs).values({
      id: 'job-1',
      repositoryId: 'repo-1',
      prNumber: 7,
      prTitle: 'Corrige bug',
      prUrl: 'https://github.com/acme/app/pull/7',
      authorLogin: 'dev',
      headSha: 'abc',
      baseSha: 'def',
      status: 'queued',
      queuedAt: 10,
    }).run();
    deps.db.insert(reviews).values({
      id: 'review-1',
      jobId: 'job-1',
      body: 'Revisão',
      event: 'COMMENT',
      status: 'posted',
      postedAt: Date.now(),
    }).run();

    const jobsResponse = await app.inject({ method: 'GET', url: '/api/jobs?status=queued&page=1&limit=10', headers: { cookie } });
    expect(jobsResponse.json()).toMatchObject({ total: 1, page: 1, limit: 10 });
    expect(jobsResponse.json().jobs[0].id).toBe('job-1');

    const reviewsResponse = await app.inject({ method: 'GET', url: '/api/reviews', headers: { cookie } });
    expect(reviewsResponse.json()).toMatchObject({ total: 1, page: 1, limit: 20 });
    expect(reviewsResponse.json().reviews[0].id).toBe('review-1');
    await app.close();
  });
});
