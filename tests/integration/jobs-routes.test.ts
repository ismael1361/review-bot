import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { activateProfile, createProfile, type ProfileInputType } from '../../src/ai/profiles';
import type { AppDeps } from '../../src/api/app';
import type { Db } from '../../src/db/client';
import { agentMessages, events, jobs, repositories, reviewFindings, reviews } from '../../src/db/schema';
import { saveGithubCredentials } from '../../src/github/credentials';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

const TOKEN = 'ghp_1234567890abcdefghij';

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

type JobStatus = (typeof jobs.$inferSelect)['status'];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function ensureRepository(db: Db): void {
  const existing = db.select().from(repositories).where(eq(repositories.id, 'r1')).get();
  if (existing) {
    return;
  }
  const now = Date.now();
  db.insert(repositories)
    .values({
      id: 'r1',
      githubId: '1',
      owner: 'a',
      name: 'b',
      fullName: 'a/b',
      private: true,
      archived: false,
      enabled: true,
      discoveredAt: now,
      updatedAt: now,
    })
    .run();
}

function seedJob(db: Db, status: JobStatus, overrides: Partial<typeof jobs.$inferInsert> = {}): string {
  ensureRepository(db);
  const now = Date.now();
  const id = uuidv7();
  db.insert(jobs)
    .values({
      id,
      repositoryId: 'r1',
      prNumber: 7,
      prTitle: 'fix: x',
      prUrl: 'https://github.com/a/b/pull/7',
      authorLogin: 'octocat',
      headSha: uuidv7(),
      baseSha: 'base',
      runSeq: 1,
      status,
      priority: 0,
      attempts: 1,
      maxAttempts: 3,
      queuedAt: now,
      ...overrides,
    })
    .run();
  return id;
}

function activateTestProfile(deps: AppDeps): void {
  const profile = createProfile(deps.db, deps.encryptionKey, PROFILE_INPUT);
  activateProfile(deps.db, profile.id);
}

async function setup() {
  const { app, deps } = await createTestApp();
  const cookie = await setupRootAndLogin(app, deps);
  return { app, deps, cookie };
}

describe('rotas de jobs', () => {
  it('cancela, reprocessa e detalha com eventos, transcript e review', async () => {
    const { app, deps, cookie } = await setup();
    const id = seedJob(deps.db, 'queued');
    const now = Date.now();
    deps.db.insert(events).values([
      { id: 'e1', jobId: id, level: 'info', type: 'job.started', message: 'início', createdAt: 1_000 },
      { id: 'e2', jobId: id, level: 'warn', type: 'job.progress', message: 'progresso', createdAt: 2_000 },
    ]).run();
    deps.db.insert(agentMessages).values([
      { id: 'm2', jobId: id, seq: 2, role: 'assistant', contentJson: '{}', createdAt: now },
      { id: 'm1', jobId: id, seq: 1, role: 'user', contentJson: '{}', createdAt: now },
    ]).run();
    deps.db.insert(reviewFindings).values({
      id: 'f1',
      jobId: id,
      path: '',
      severity: 'strength',
      title: 'Bom',
      bodyMd: 'corpo',
      status: 'outside_diff',
      createdAt: now,
    }).run();
    deps.db.insert(reviews).values({
      id: 'rv1',
      jobId: id,
      body: 'review',
      event: 'COMMENT',
      status: 'posted',
      postedAt: now,
    }).run();

    const cancel = await app.inject({ method: 'POST', url: `/api/jobs/${id}/cancel`, headers: { cookie } });
    expect(cancel.statusCode).toBe(204);

    const retry = await app.inject({ method: 'POST', url: `/api/jobs/${id}/retry`, headers: { cookie } });
    expect(retry.statusCode).toBe(204);

    const detail = await app.inject({ method: 'GET', url: `/api/jobs/${id}`, headers: { cookie } });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.job.id).toBe(id);
    expect(body.job.status).toBe('queued');
    expect(body.findings.map((finding: { id: string }) => finding.id)).toEqual(['f1']);
    expect(body.events.map((event: { id: string }) => event.id)).toEqual(['e2', 'e1']);
    expect(body.transcript.map((message: { seq: number }) => message.seq)).toEqual([1, 2]);
    expect(body.review.id).toBe('rv1');
    await app.close();
  });

  it('lista jobs com nome do repositório e campos anteriores', async () => {
    const { app, deps, cookie } = await setup();
    const id = seedJob(deps.db, 'queued');

    const response = await app.inject({ method: 'GET', url: '/api/jobs', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json().jobs[0]).toMatchObject({
      id,
      repositoryId: 'r1',
      prNumber: 7,
      prTitle: 'fix: x',
      status: 'queued',
      attempts: 1,
      repoFullName: 'a/b',
    });
    await app.close();
  });

  it('calcula posição global da fila por prioridade e ordem de chegada', async () => {
    const { app, deps, cookie } = await setup();
    const low = seedJob(deps.db, 'queued', { prNumber: 1, priority: 0, queuedAt: 1_000 });
    const high = seedJob(deps.db, 'queued', { prNumber: 2, priority: 5, queuedAt: 2_000 });
    const older = seedJob(deps.db, 'queued', { prNumber: 3, priority: 0, queuedAt: 500 });
    const running = seedJob(deps.db, 'running', { prNumber: 4, priority: 10, queuedAt: 3_000, startedAt: 3_500 });

    const page = await app.inject({ method: 'GET', url: '/api/jobs?limit=3', headers: { cookie } });
    const rows = page.json().jobs as Array<{ id: string; queuePosition: number | null }>;
    const positionById = new Map(rows.map((row) => [row.id, row.queuePosition]));
    expect(positionById.get(high)).toBe(1);
    expect(positionById.get(low)).toBe(3);
    expect(positionById.has(older)).toBe(false);
    expect(positionById.get(running)).toBeNull();

    const queued = await app.inject({ method: 'GET', url: '/api/jobs?status=queued&limit=10', headers: { cookie } });
    const queuedPositions = new Map(
      (queued.json().jobs as Array<{ id: string; queuePosition: number | null }>).map((row) => [row.id, row.queuePosition]),
    );
    expect(queuedPositions.get(older)).toBe(2);
    expect(queuedPositions.get(high)).toBe(1);
    await app.close();
  });

  it('rejeita cancelamento em estado inválido', async () => {
    const { app, deps, cookie } = await setup();
    const id = seedJob(deps.db, 'failed');

    const response = await app.inject({ method: 'POST', url: `/api/jobs/${id}/cancel`, headers: { cookie } });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('invalid_state');
    await app.close();
  });

  it('retorna 404 ao detalhar job inexistente', async () => {
    const { app, cookie } = await setup();

    const response = await app.inject({ method: 'GET', url: '/api/jobs/nao-existe', headers: { cookie } });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('job_not_found');
    await app.close();
  });

  it('enfileira manualmente com perfil ativo e respeita duplicata e force', async () => {
    const { app, deps, cookie } = await setup();
    activateTestProfile(deps);
    saveGithubCredentials(deps.db, deps.encryptionKey, { login: 'bot', pat: TOKEN, scopes: 'repo' });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/pulls/9')) {
        return jsonResponse({
          title: 'fix: manual',
          html_url: 'https://github.com/acme/api/pull/9',
          draft: false,
          head: { sha: 'sha9' },
          base: { sha: 'base' },
          user: { login: 'octocat' },
        });
      }
      return jsonResponse({ id: 1, full_name: 'acme/api', archived: false, private: true });
    }) as unknown as typeof fetch;
    deps.fetchImpl = fetchImpl;

    const first = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { cookie },
      payload: { repoFullName: 'acme/api', prNumber: 9 },
    });
    expect(first.statusCode).toBe(201);
    expect(first.json().jobId).toBeTypeOf('string');

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { cookie },
      payload: { repoFullName: 'acme/api', prNumber: 9 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('job_exists');

    const forced = await app.inject({
      method: 'POST',
      url: '/api/jobs',
      headers: { cookie },
      payload: { repoFullName: 'acme/api', prNumber: 9, force: true },
    });
    expect(forced.statusCode).toBe(201);
    expect(forced.json().jobId).not.toBe(first.json().jobId);
    expect(deps.db.select().from(jobs).all()).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    await app.close();
  });

  it('publica review somente com resumo quando não há achados', async () => {
    const { app, deps, cookie } = await setup();
    const id = seedJob(deps.db, 'succeeded', { summaryMd: 'Resumo técnico sem achados.' });
    saveGithubCredentials(deps.db, deps.encryptionKey, { login: 'bot', pat: TOKEN, scopes: 'repo' });
    const posts: Array<{ body: string; comments?: unknown[] }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes('/repos/a/b/pulls/7/reviews')) {
        return new Response('{}', { status: 404 });
      }
      if ((init?.method ?? 'GET') === 'GET') {
        return jsonResponse([]);
      }
      posts.push(JSON.parse(String(init?.body)) as { body: string; comments?: unknown[] });
      return jsonResponse({ id: 77, html_url: 'https://github.com/a/b/pull/7#review-77' });
    }) as unknown as typeof fetch;
    deps.fetchImpl = fetchImpl;

    const response = await app.inject({ method: 'POST', url: `/api/jobs/${id}/publish-review`, headers: { cookie } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'posted', reviewId: '77', commentsPosted: 0, commentsFallback: 0 });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toContain('Resumo técnico sem achados.');
    expect(posts[0]!.comments).toEqual([]);
    const review = deps.db.select().from(reviews).where(eq(reviews.jobId, id)).get();
    expect(review?.status).toBe('posted');
    expect(review?.githubReviewId).toBe('77');
    await app.close();
  });

  it('rejeita publicação de job em execução', async () => {
    const { app, deps, cookie } = await setup();
    const id = seedJob(deps.db, 'running');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    deps.fetchImpl = fetchImpl;

    const response = await app.inject({ method: 'POST', url: `/api/jobs/${id}/publish-review`, headers: { cookie } });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('invalid_state');
    expect(fetchImpl).not.toHaveBeenCalled();
    await app.close();
  });

  it('retorna 404 ao publicar review de job inexistente', async () => {
    const { app, cookie } = await setup();

    const response = await app.inject({ method: 'POST', url: '/api/jobs/nao-existe/publish-review', headers: { cookie } });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('job_not_found');
    await app.close();
  });
});

describe('rotas de reviews', () => {
  it('detalha review com job, achados e transcript', async () => {
    const { app, deps, cookie } = await setup();
    const id = seedJob(deps.db, 'succeeded');
    const now = Date.now();
    deps.db.insert(reviewFindings).values({
      id: 'f1',
      jobId: id,
      path: 'src/a.ts',
      startLine: 1,
      endLine: 1,
      severity: 'critical',
      title: 'Bug',
      bodyMd: 'corpo',
      status: 'posted',
      createdAt: now,
    }).run();
    deps.db.insert(agentMessages).values([
      { id: 'm2', jobId: id, seq: 2, role: 'assistant', contentJson: '{}', createdAt: now },
      { id: 'm1', jobId: id, seq: 1, role: 'user', contentJson: '{}', createdAt: now },
    ]).run();
    deps.db.insert(reviews).values({
      id: 'rv1',
      jobId: id,
      githubReviewId: '77',
      url: 'https://github.com/a/b/pull/7#review-77',
      body: 'review',
      event: 'COMMENT',
      status: 'posted',
      postedAt: now,
    }).run();

    const response = await app.inject({ method: 'GET', url: '/api/reviews/rv1', headers: { cookie } });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.review.id).toBe('rv1');
    expect(body.job.id).toBe(id);
    expect(body.findings.map((finding: { id: string }) => finding.id)).toEqual(['f1']);
    expect(body.transcript.map((message: { seq: number }) => message.seq)).toEqual([1, 2]);
    await app.close();
  });

  it('retorna 404 ao detalhar review inexistente', async () => {
    const { app, cookie } = await setup();

    const response = await app.inject({ method: 'GET', url: '/api/reviews/nao-existe', headers: { cookie } });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('review_not_found');
    await app.close();
  });
});

describe('RBAC de jobs', () => {
  it('exige autenticação para detalhar job', async () => {
    const { app, deps } = await setup();
    const id = seedJob(deps.db, 'queued');

    const response = await app.inject({ method: 'GET', url: `/api/jobs/${id}` });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('unauthenticated');
    await app.close();
  });

  it('permite leitura ao viewer mas bloqueia cancelamento', async () => {
    const { app, deps, cookie } = await setup();
    const id = seedJob(deps.db, 'queued');
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie },
      payload: { username: 'ana', password: 'senha-muito-segura', role: 'viewer' },
    });
    expect(created.statusCode).toBe(201);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'ana', password: 'senha-muito-segura' },
    });
    const viewerCookie = `prr_session=${login.cookies.find((item) => item.name === 'prr_session')!.value}`;

    const detail = await app.inject({ method: 'GET', url: `/api/jobs/${id}`, headers: { cookie: viewerCookie } });
    expect(detail.statusCode).toBe(200);

    const cancel = await app.inject({ method: 'POST', url: `/api/jobs/${id}/cancel`, headers: { cookie: viewerCookie } });
    expect(cancel.statusCode).toBe(403);
    expect(cancel.json().error.code).toBe('forbidden');
    await app.close();
  });
});
