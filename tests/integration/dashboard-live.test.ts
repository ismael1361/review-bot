import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { activateProfile, createProfile, profileSnapshotJson } from '../../src/ai/profiles';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';
import type { Db } from '../../src/db/client';
import { aiProfiles, events, jobs, repositories, reviewFindings, reviews, webhookDeliveries, webhooks } from '../../src/db/schema';
import { setSetting } from '../../src/db/settings';
import { saveGithubCredentials } from '../../src/github/credentials';
import { createWorker } from '../../src/jobs/worker';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const REPOSITORY_ID = 'repo-dashboard';

function utcKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function seedRepository(db: Db, now: number, id = REPOSITORY_ID, fullName = 'acme/app'): void {
  const [owner, name] = fullName.split('/');
  db.insert(repositories)
    .values({
      id,
      githubId: id,
      owner: owner ?? 'acme',
      name: name ?? 'app',
      fullName,
      private: false,
      archived: false,
      enabled: true,
      discoveredAt: now,
      updatedAt: now,
    })
    .run();
}

function insertJob(db: Db, overrides: Partial<typeof jobs.$inferInsert> = {}): string {
  const now = Date.now();
  const id = uuidv7();
  db.insert(jobs)
    .values({
      id,
      repositoryId: REPOSITORY_ID,
      prNumber: 1,
      prTitle: 't',
      prUrl: 'u',
      authorLogin: 'x',
      headSha: uuidv7(),
      baseSha: 'b',
      runSeq: 1,
      status: 'succeeded',
      priority: 0,
      attempts: 1,
      maxAttempts: 3,
      queuedAt: now,
      ...overrides,
    })
    .run();
  return id;
}

function insertReview(db: Db, jobId: string, overrides: Partial<typeof reviews.$inferInsert> = {}): string {
  const id = overrides.id ?? uuidv7();
  db.insert(reviews)
    .values({
      id,
      jobId,
      body: 'review',
      event: 'COMMENT',
      status: 'posted',
      postedAt: Date.now(),
      ...overrides,
    })
    .run();
  return id;
}

function insertFinding(
  db: Db,
  jobId: string,
  severity: 'critical' | 'medium' | 'suggestion' | 'strength',
  overrides: Partial<typeof reviewFindings.$inferInsert> = {},
): string {
  const id = uuidv7();
  db.insert(reviewFindings)
    .values({
      id,
      jobId,
      path: 'src/a.ts',
      severity,
      title: `Achado ${severity}`,
      bodyMd: 'corpo',
      status: 'posted',
      createdAt: Date.now(),
      ...overrides,
    })
    .run();
  return id;
}

function seedReviewFixture(db: Db) {
  const now = Date.now();
  seedRepository(db, now);
  seedRepository(db, now, 'repo-lib', 'acme/lib');
  const jobA1 = insertJob(db, { prNumber: 10, prTitle: 'PR A1', queuedAt: now - 3 * DAY_MS });
  const jobA2 = insertJob(db, { prNumber: 11, prTitle: 'PR A2', queuedAt: now - 3 * DAY_MS });
  const jobA3 = insertJob(db, { prNumber: 12, prTitle: 'PR A3', queuedAt: now - 11 * DAY_MS });
  const jobB1 = insertJob(db, { repositoryId: 'repo-lib', prNumber: 20, prTitle: 'PR B1', queuedAt: now - 3 * DAY_MS });
  const reviewA1 = insertReview(db, jobA1, { id: 'rev-1', postedAt: now - HOUR_MS, commentsPosted: 2, body: 'corpo 1' });
  const reviewA2 = insertReview(db, jobA2, { id: 'rev-2', status: 'fallback', postedAt: now - 2 * DAY_MS, body: 'corpo 2' });
  const reviewA3 = insertReview(db, jobA3, { id: 'rev-4', postedAt: now - 10 * DAY_MS, body: 'corpo 4' });
  const reviewB1 = insertReview(db, jobB1, { id: 'rev-3', status: 'failed', postedAt: null, body: 'corpo 3' });
  insertFinding(db, jobA1, 'critical');
  insertFinding(db, jobA1, 'medium');
  insertFinding(db, jobA1, 'suggestion');
  insertFinding(db, jobA1, 'strength');
  insertFinding(db, jobA2, 'medium');
  insertFinding(db, jobB1, 'suggestion');
  return {
    now,
    jobs: { a1: jobA1, a2: jobA2, a3: jobA3, b1: jobB1 },
    reviews: { a1: reviewA1, a2: reviewA2, a3: reviewA3, b1: reviewB1 },
  };
}

describe('dashboard ao vivo', () => {
  it('soma tokens de vários jobs e ignora usageJson inválido ou valores inválidos', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    seedRepository(deps.db, Date.now());
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 100, output: 20 }) });
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 50, output: 5 }) });
    insertJob(deps.db, { usageJson: '{inválido' });
    insertJob(deps.db, { usageJson: JSON.stringify({ input: '50', output: -5 }) });
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 30, output: -10 }) });
    insertJob(deps.db, { usageJson: 'null' });

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().tokens).toEqual({ input: 180, output: 25, last7dInput: 0, last7dOutput: 0 });
    await app.close();
  });

  it('soma tokens dos últimos 7 dias usando finishedAt', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    seedRepository(deps.db, now);
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 100, output: 20 }), finishedAt: now - DAY_MS });
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 50, output: 5 }), finishedAt: now - 2 * DAY_MS });
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 200, output: 40 }), finishedAt: now - 8 * DAY_MS });
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 7, output: 3 }), finishedAt: null });

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    expect(dashboard.json().tokens).toEqual({ input: 357, output: 68, last7dInput: 150, last7dOutput: 25 });
    await app.close();
  });

  it('conta reviews nas janelas de 24h e 7 dias e ignora postedAt nulo', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    seedRepository(deps.db, now);
    const recentJob = insertJob(deps.db);
    const weekJob = insertJob(deps.db);
    const oldJob = insertJob(deps.db);
    const nullJob = insertJob(deps.db);
    deps.db.insert(reviews).values([
      { id: uuidv7(), jobId: recentJob, body: 'recente', event: 'COMMENT', status: 'posted', postedAt: now - HOUR_MS },
      { id: uuidv7(), jobId: weekJob, body: 'semana', event: 'COMMENT', status: 'posted', postedAt: now - 3 * DAY_MS },
      { id: uuidv7(), jobId: oldJob, body: 'antiga', event: 'COMMENT', status: 'posted', postedAt: now - 8 * DAY_MS },
      { id: uuidv7(), jobId: nullJob, body: 'sem data', event: 'COMMENT', status: 'posted', postedAt: null },
    ]).run();

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().reviews).toEqual({ total: 4, last24h: 1, last7d: 2 });
    await app.close();
  });

  it('reflete pausa da fila e concorrência das configurações', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    seedRepository(deps.db, Date.now());
    insertJob(deps.db, { status: 'queued' });
    insertJob(deps.db, { status: 'running', startedAt: Date.now() });
    await app.inject({
      method: 'PUT',
      url: '/api/settings/system',
      headers: { cookie },
      payload: { pollingIntervalSec: 120, retentionDays: 30, concurrency: 2, ignoreDrafts: true, skipOwnPrs: false },
    });
    await app.inject({ method: 'POST', url: '/api/queue/pause', headers: { cookie } });

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    const data = dashboard.json();
    expect(data.queue).toEqual({ queued: 1, running: 1, paused: true, concurrency: 2 });
    expect(data.health.queuePaused).toBe(true);
    await app.close();
  });

  it('expõe execução atual e fila ao vivo com repositório', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    seedRepository(deps.db, now);
    const queuedIds: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      queuedIds.push(
        insertJob(deps.db, {
          status: 'queued',
          prNumber: 100 + index,
          prTitle: `Fila ${index}`,
          prUrl: `https://github.com/acme/app/pull/${100 + index}`,
          queuedAt: now - 1_000 + index,
        }),
      );
    }
    const runningId = insertJob(deps.db, {
      status: 'running',
      prNumber: 42,
      prTitle: 'Em andamento',
      prUrl: 'https://github.com/acme/app/pull/42',
      queuedAt: now - 5_000,
      startedAt: now - 4_000,
    });

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    const data = dashboard.json();
    expect(data.current).toEqual({
      id: runningId,
      prNumber: 42,
      prTitle: 'Em andamento',
      prUrl: 'https://github.com/acme/app/pull/42',
      repoFullName: 'acme/app',
      queuedAt: now - 5_000,
      startedAt: now - 4_000,
    });
    expect(data.liveQueue).toHaveLength(6);
    expect(data.liveQueue[0]).toEqual({ ...data.current, status: 'running' });
    expect(data.liveQueue[1]).toMatchObject({ id: queuedIds[0], status: 'queued', repoFullName: 'acme/app' });
    await app.close();
  });

  it('lista as cinco reviews recentes com contagens de severidade', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    seedRepository(deps.db, now);
    const jobIds: string[] = [];
    const reviewIds: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const jobId = insertJob(deps.db, { prNumber: index + 1, prTitle: `PR ${index}` });
      jobIds.push(jobId);
      reviewIds.push(
        insertReview(deps.db, jobId, {
          postedAt: now - index * 1_000,
          commentsPosted: index,
          status: index === 1 ? 'fallback' : 'posted',
        }),
      );
    }
    insertFinding(deps.db, jobIds[0]!, 'critical');
    insertFinding(deps.db, jobIds[0]!, 'critical');
    insertFinding(deps.db, jobIds[0]!, 'medium');
    insertFinding(deps.db, jobIds[1]!, 'suggestion');
    insertFinding(deps.db, jobIds[1]!, 'strength');

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    const recentReviews = dashboard.json().recentReviews;
    expect(recentReviews).toHaveLength(5);
    expect(recentReviews.map((review: { id: string }) => review.id)).toEqual(reviewIds.slice(0, 5));
    expect(recentReviews[0]).toMatchObject({
      jobId: jobIds[0],
      prNumber: 1,
      prTitle: 'PR 0',
      repoFullName: 'acme/app',
      status: 'posted',
      commentsPosted: 0,
      postedAt: now,
      critical: 2,
      medium: 1,
      suggestion: 0,
    });
    expect(recentReviews[1]).toMatchObject({ status: 'fallback', critical: 0, medium: 0, suggestion: 1 });
    await app.close();
  });

  it('agrega achados por severidade e os cinco repositórios com mais achados', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    const repoNames = ['acme/app', 'acme/lib', 'acme/api', 'acme/web', 'acme/docs', 'acme/tools'];
    const counts = [5, 4, 3, 2, 1, 1];
    const severities = ['critical', 'medium', 'suggestion', 'strength'] as const;
    let findingIndex = 0;
    repoNames.forEach((fullName, repoIndex) => {
      const repositoryId = `repo-${repoIndex}`;
      seedRepository(deps.db, now, repositoryId, fullName);
      const jobId = insertJob(deps.db, { repositoryId, prNumber: repoIndex + 1 });
      for (let index = 0; index < counts[repoIndex]!; index += 1) {
        insertFinding(deps.db, jobId, severities[findingIndex % severities.length]!);
        findingIndex += 1;
      }
    });

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    expect(dashboard.json().findings).toEqual({
      critical: 4,
      medium: 4,
      suggestion: 4,
      strength: 4,
      total: 16,
      topRepositories: [
        { fullName: 'acme/app', count: 5 },
        { fullName: 'acme/lib', count: 4 },
        { fullName: 'acme/api', count: 3 },
        { fullName: 'acme/web', count: 2 },
        { fullName: 'acme/docs', count: 1 },
      ],
    });
    await app.close();
  });

  it('gera sete posições de tendência em UTC, incluindo dias vazios', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    seedRepository(deps.db, now);
    const reviewJob = insertJob(deps.db);
    insertReview(deps.db, reviewJob, { postedAt: now });
    insertJob(deps.db, { status: 'failed', finishedAt: now - 2 * DAY_MS });
    insertJob(deps.db, {
      usageJson: JSON.stringify({ input: 10, output: 5 }),
      finishedAt: now - 3 * DAY_MS,
    });
    insertJob(deps.db, { status: 'failed', finishedAt: now - 8 * DAY_MS });

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    const trends = dashboard.json().trends;
    const expectedDates: string[] = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      expectedDates.push(utcKey(now - offset * DAY_MS));
    }
    expect(trends.map((trend: { date: string }) => trend.date)).toEqual(expectedDates);
    const byDate = new Map(trends.map((trend: { date: string }) => [trend.date, trend]));
    expect(byDate.get(utcKey(now))).toMatchObject({ reviews: 1, failures: 0, tokens: 0 });
    expect(byDate.get(utcKey(now - DAY_MS))).toMatchObject({ reviews: 0, failures: 0, tokens: 0 });
    expect(byDate.get(utcKey(now - 2 * DAY_MS))).toMatchObject({ reviews: 0, failures: 1, tokens: 0 });
    expect(byDate.get(utcKey(now - 3 * DAY_MS))).toMatchObject({ reviews: 0, failures: 0, tokens: 15 });
    await app.close();
  });

  it('calcula lastPollAt, falhas de webhook e falhas de autenticação do polling', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    deps.db.insert(events).values([
      { id: 'e1', jobId: null, level: 'info', type: 'poll.updated', message: 'antigo', createdAt: now - 5_000 },
      { id: 'e2', jobId: null, level: 'info', type: 'poll.updated', message: 'recente', createdAt: now - 1_000 },
      { id: 'e3', jobId: null, level: 'info', type: 'poll.skipped', message: 'outro', createdAt: now - 500 },
    ]).run();
    deps.db.insert(webhooks).values({
      id: 'wh-1',
      url: 'https://example.com/hook',
      secretEncrypted: 'x',
      eventsJson: '[]',
      enabled: true,
      createdAt: now - 10 * DAY_MS,
      updatedAt: now - 10 * DAY_MS,
    }).run();
    deps.db.insert(webhookDeliveries).values([
      { id: 'd1', webhookId: 'wh-1', event: 'job.failed', success: false, attempt: 1, createdAt: now - HOUR_MS },
      { id: 'd2', webhookId: 'wh-1', event: 'job.failed', success: false, attempt: 2, createdAt: now - 2 * HOUR_MS },
      { id: 'd3', webhookId: 'wh-1', event: 'job.failed', success: true, attempt: 1, createdAt: now - 30 * 60 * 1000 },
      { id: 'd4', webhookId: 'wh-1', event: 'job.failed', success: false, attempt: 1, createdAt: now - 25 * HOUR_MS },
    ]).run();
    setSetting(deps.db, 'poller_paused', true);
    setSetting(deps.db, 'poll_auth_failures', 2);

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    expect(dashboard.json().health).toEqual({
      pollerPaused: true,
      queuePaused: false,
      pollAuthFailures: 2,
      lastPollAt: now - 1_000,
      webhookFailures24h: 2,
    });
    await app.close();
  });

  it('reflete credencial GitHub e perfil ativo no onboarding', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const before = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });
    expect(before.json().onboarding).toEqual({ githubConfigured: false, activeProfile: false, pollingEnabled: false });
    saveGithubCredentials(deps.db, deps.encryptionKey, { login: 'bot', pat: 'ghp_1234567890abcdefghij', scopes: 'repo' });
    const profile = createProfile(deps.db, deps.encryptionKey, {
      name: 'Perfil',
      provider: 'openai_compatible',
      baseUrl: 'https://p.exemplo.com/v1',
      model: 'modelo-x',
      apiKey: 'chave',
      temperature: 0.2,
      maxOutputTokens: 4096,
      maxTurns: 10,
      maxTotalTokens: 100000,
      maxDurationSec: 600,
      maxFindings: 25,
      maxGithubCalls: 80,
      prePrompt: '',
      skillIds: [],
    });
    activateProfile(deps.db, profile.id);

    const after = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    expect(after.json().onboarding).toEqual({ githubConfigured: true, activeProfile: true, pollingEnabled: true });
    await app.close();
  });

  it('calcula taxa de falha e duração média dos jobs concluídos em 7 dias', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    seedRepository(deps.db, now);
    insertJob(deps.db, { status: 'succeeded', startedAt: now - 20_000, finishedAt: now });
    insertJob(deps.db, { status: 'partial', startedAt: now - 40_000, finishedAt: now });
    insertJob(deps.db, { status: 'failed', startedAt: now - 60_000, finishedAt: now });
    insertJob(deps.db, { status: 'cancelled', startedAt: now - 10_000, finishedAt: now });
    insertJob(deps.db, { status: 'failed', startedAt: now - 8 * DAY_MS - 30_000, finishedAt: now - 8 * DAY_MS });

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    const data = dashboard.json();
    expect(data.failures).toBe(2);
    expect(data.failuresLast7d).toBe(1);
    expect(data.failureRate7d).toBeCloseTo(1 / 3, 10);
    expect(data.avgDurationSec7d).toBe(40);
    await app.close();
  });

  it('publica job.started e job.finished no bus durante o worker', async () => {
    const { app, deps } = await createTestApp();
    const now = Date.now();
    seedRepository(deps.db, now);
    const jobId = insertJob(deps.db, { status: 'queued', attempts: 0, nextAttemptAt: now });
    const received: { type: string; data: unknown }[] = [];
    deps.bus.subscribe((event) => received.push(event));
    const worker = createWorker(
      { db: deps.db, bus: deps.bus, logger: deps.logger, encryptionKey: deps.encryptionKey, handler: async () => ({ status: 'succeeded' }) },
      'w1',
    );

    expect(await worker.tick()).toBe(true);
    expect(received.map((event) => event.type)).toEqual(['job.started', 'job.finished']);
    expect(received[0]?.data).toMatchObject({ jobId });
    expect(received[1]?.data).toMatchObject({ jobId, status: 'succeeded' });
    await app.close();
  });
});

describe('reviews com joins e filtros', () => {
  it('lista reviews com dados do job, repositório e contagens de severidade', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const fixture = seedReviewFixture(deps.db);

    const response = await app.inject({ method: 'GET', url: '/api/reviews', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ total: 4, page: 1, limit: 20 });
    expect(body.reviews.map((review: { id: string }) => review.id)).toEqual([
      fixture.reviews.a1,
      fixture.reviews.a2,
      fixture.reviews.a3,
      fixture.reviews.b1,
    ]);
    expect(body.reviews[0]).toMatchObject({
      id: 'rev-1',
      jobId: fixture.jobs.a1,
      body: 'corpo 1',
      status: 'posted',
      commentsPosted: 2,
      repoFullName: 'acme/app',
      prNumber: 10,
      prTitle: 'PR A1',
      critical: 1,
      medium: 1,
      suggestion: 1,
    });
    expect(body.reviews[2]).toMatchObject({ repoFullName: 'acme/app', prNumber: 12, critical: 0, medium: 0, suggestion: 0 });
    expect(body.reviews[3]).toMatchObject({ repoFullName: 'acme/lib', prNumber: 20, postedAt: null });
    await app.close();
  });

  it('filtra por repositório, PR, status e severidade mantendo o total', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const fixture = seedReviewFixture(deps.db);
    const get = async (query: string) => {
      const response = await app.inject({ method: 'GET', url: `/api/reviews?${query}`, headers: { cookie } });
      expect(response.statusCode).toBe(200);
      return response.json();
    };

    const byRepo = await get('repoFullName=acme/lib');
    expect(byRepo.reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.b1]);
    expect(byRepo.total).toBe(1);

    const byPr = await get('prNumber=10');
    expect(byPr.reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.a1]);

    const byStatus = await get('status=failed');
    expect(byStatus.reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.b1]);

    const bySeverity = await get('severity=critical');
    expect(bySeverity.reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.a1]);
    expect(bySeverity.reviews[0]).toMatchObject({ critical: 1, medium: 1, suggestion: 1 });

    const byMedium = await get('severity=medium');
    expect(byMedium.reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.a1, fixture.reviews.a2]);
    await app.close();
  });

  it('combina filtros de repositório, status, severidade e período com paginação', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const fixture = seedReviewFixture(deps.db);
    const get = async (query: string) => {
      const response = await app.inject({ method: 'GET', url: `/api/reviews?${query}`, headers: { cookie } });
      expect(response.statusCode).toBe(200);
      return response.json();
    };

    const combined = await get(
      'repoFullName=acme/app&status=posted&severity=suggestion&periodDays=1&page=1&limit=1',
    );
    expect(combined).toMatchObject({ total: 1, page: 1, limit: 1 });
    expect(combined.reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.a1]);
    expect(combined.reviews[0]).toMatchObject({ critical: 1, medium: 1, suggestion: 1 });

    const secondPage = await get('repoFullName=acme/app&page=2&limit=1');
    expect(secondPage).toMatchObject({ total: 3, page: 2, limit: 1 });
    expect(secondPage.reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.a2]);
    expect(secondPage.reviews[0]).toMatchObject({ critical: 0, medium: 1, suggestion: 0 });
    await app.close();
  });

  it('filtra por período e exclui postedAt nulo', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const fixture = seedReviewFixture(deps.db);

    const response = await app.inject({ method: 'GET', url: '/api/reviews?periodDays=1', headers: { cookie } });

    const body = response.json();
    expect(body.total).toBe(1);
    expect(body.reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.a1]);
    await app.close();
  });

  it('pagina o resultado filtrado', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const fixture = seedReviewFixture(deps.db);

    const pageTwo = await app.inject({ method: 'GET', url: '/api/reviews?page=2&limit=1', headers: { cookie } });
    expect(pageTwo.json()).toMatchObject({ total: 4, page: 2, limit: 1 });
    expect(pageTwo.json().reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.a2]);

    const filtered = await app.inject({ method: 'GET', url: '/api/reviews?severity=medium&page=2&limit=1', headers: { cookie } });
    expect(filtered.json()).toMatchObject({ total: 2, page: 2, limit: 1 });
    expect(filtered.json().reviews.map((review: { id: string }) => review.id)).toEqual([fixture.reviews.a2]);
    await app.close();
  });

  it('detalha review com repositório, eventos em ordem e perfil sanitizado', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const fixture = seedReviewFixture(deps.db);
    const profile = createProfile(deps.db, deps.encryptionKey, {
      name: 'Perfil detalhe',
      provider: 'anthropic',
      baseUrl: 'https://p.exemplo.com/v1',
      model: 'claude-teste',
      apiKey: 'chave-secreta',
      temperature: 0.2,
      maxOutputTokens: 4096,
      maxTurns: 10,
      maxTotalTokens: 100000,
      maxDurationSec: 600,
      maxFindings: 25,
      maxGithubCalls: 80,
      prePrompt: '',
      skillIds: [],
    });
    deps.db.update(jobs).set({ profileId: profile.id, profileSnapshotJson: '{invalido' }).where(eq(jobs.id, fixture.jobs.a1)).run();
    deps.db.insert(events).values([
      { id: 'ev-2', jobId: fixture.jobs.a1, level: 'info', type: 'job.updated', message: 'segundo', createdAt: fixture.now - 50 },
      { id: 'ev-1', jobId: fixture.jobs.a1, level: 'info', type: 'job.started', message: 'primeiro', createdAt: fixture.now - 100 },
      { id: 'ev-other', jobId: fixture.jobs.a2, level: 'info', type: 'job.updated', message: 'outro job', createdAt: fixture.now - 25 },
    ]).run();

    const response = await app.inject({ method: 'GET', url: `/api/reviews/${fixture.reviews.a1}`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.review.id).toBe(fixture.reviews.a1);
    expect(body.job.id).toBe(fixture.jobs.a1);
    expect(body.repository).toEqual({ id: REPOSITORY_ID, owner: 'acme', name: 'app', fullName: 'acme/app' });
    expect(body.events.map((event: { id: string }) => event.id)).toEqual(['ev-1', 'ev-2']);
    expect(body.events.map((event: { createdAt: number }) => event.createdAt)).toEqual([fixture.now - 100, fixture.now - 50]);
    expect(body.profile).toEqual({ id: profile.id, name: 'Perfil detalhe', provider: 'anthropic', model: 'claude-teste' });
    expect(JSON.stringify(body.profile)).not.toContain('apiKeyEncrypted');
    await app.close();
  });

  it('usa o perfil do snapshot do job e ignora edições posteriores', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    seedRepository(deps.db, now);
    const profile = createProfile(deps.db, deps.encryptionKey, {
      name: 'Perfil original',
      provider: 'anthropic',
      baseUrl: 'https://p.exemplo.com/v1',
      model: 'claude-original',
      apiKey: 'chave-secreta',
      temperature: 0.2,
      maxOutputTokens: 4096,
      maxTurns: 10,
      maxTotalTokens: 100000,
      maxDurationSec: 600,
      maxFindings: 25,
      maxGithubCalls: 80,
      prePrompt: '',
      skillIds: [],
    });
    const profileRow = deps.db.select().from(aiProfiles).where(eq(aiProfiles.id, profile.id)).get()!;
    const jobId = insertJob(deps.db, {
      profileId: profile.id,
      profileSnapshotJson: profileSnapshotJson(profileRow),
      queuedAt: now - 1_000,
    });
    const reviewId = insertReview(deps.db, jobId, { id: 'rev-snapshot', postedAt: now - 500 });
    deps.db
      .update(aiProfiles)
      .set({ name: 'Perfil editado', model: 'claude-editado' })
      .where(eq(aiProfiles.id, profile.id))
      .run();

    const response = await app.inject({ method: 'GET', url: `/api/reviews/${reviewId}`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json().profile).toEqual({
      id: profile.id,
      name: 'Perfil original',
      provider: 'anthropic',
      model: 'claude-original',
    });
    await app.close();
  });

  it('limita a timeline da review aos 200 eventos mais recentes em ordem crescente', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    seedRepository(deps.db, now);
    const jobId = insertJob(deps.db);
    const reviewId = insertReview(deps.db, jobId, { id: 'rev-cap' });
    const values = [];
    for (let index = 0; index < 205; index += 1) {
      values.push({
        id: `ev-${index}`,
        jobId,
        level: 'info' as const,
        type: 'job.updated',
        message: `evento ${index}`,
        createdAt: now - (205 - index) * 1_000,
      });
    }
    deps.db.insert(events).values(values).run();

    const response = await app.inject({ method: 'GET', url: `/api/reviews/${reviewId}`, headers: { cookie } });

    const body = response.json();
    expect(body.events).toHaveLength(200);
    expect(body.events[0].createdAt).toBe(now - 200 * 1_000);
    expect(body.events[199].createdAt).toBe(now - 1_000);
    await app.close();
  });
});
