import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { describe, expect, it, vi } from 'vitest';
import { jobs, repositories, reviewFindings, reviews } from '../../src/db/schema';
import { buildReviewBody, publishReview } from '../../src/github/publisher';
import { listFindings, type FindingRow } from '../../src/jobs/findings';
import { createTestDb } from '../helpers/db';

type FindingSeed = {
  path: string;
  startLine: number | null;
  endLine: number | null;
  severity: 'critical' | 'medium' | 'suggestion' | 'strength';
  title: string;
  bodyMd: string;
  suggestionMd?: string;
  status: 'valid' | 'outside_diff' | 'posted' | 'fallback';
};

type PostedComment = {
  path: string;
  line: number;
  side: string;
  body: string;
  start_line?: number;
  start_side?: string;
};

type PostedPayload = {
  commit_id: string;
  event: string;
  body: string;
  comments?: PostedComment[];
};

const NOW = 1_700_000_000_000;
const MARKER = '<!-- pr-reviewer:job:j1 -->';

const DEFAULT_FINDINGS: FindingSeed[] = [
  {
    path: 'src/a.ts',
    startLine: 44,
    endLine: 44,
    severity: 'critical',
    title: 'Bug',
    bodyMd: 'corpo do bug',
    suggestionMd: 'fix()',
    status: 'valid',
  },
  {
    path: 'src/b.ts',
    startLine: 44,
    endLine: 46,
    severity: 'medium',
    title: 'Intervalo',
    bodyMd: 'corpo multi',
    status: 'valid',
  },
  {
    path: 'src/c.ts',
    startLine: 10,
    endLine: 10,
    severity: 'suggestion',
    title: 'Fora',
    bodyMd: 'corpo fora',
    status: 'outside_diff',
  },
  {
    path: 'src/d.ts',
    startLine: null,
    endLine: 50,
    severity: 'strength',
    title: 'Legado',
    bodyMd: 'corpo legado',
    status: 'valid',
  },
];

function seed(findings: FindingSeed[] = DEFAULT_FINDINGS) {
  const db = createTestDb();
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
      discoveredAt: NOW,
      updatedAt: NOW,
    })
    .run();
  db.insert(jobs)
    .values({
      id: 'j1',
      repositoryId: 'r1',
      prNumber: 7,
      prTitle: 't',
      prUrl: 'u',
      authorLogin: 'x',
      headSha: 'sha1',
      baseSha: 'b',
      runSeq: 1,
      status: 'running',
      priority: 0,
      attempts: 1,
      maxAttempts: 3,
      queuedAt: NOW,
    })
    .run();
  for (const finding of findings) {
    db.insert(reviewFindings)
      .values({
        id: uuidv7(),
        jobId: 'j1',
        path: finding.path,
        startLine: finding.startLine,
        endLine: finding.endLine,
        side: 'RIGHT',
        severity: finding.severity,
        title: finding.title,
        bodyMd: finding.bodyMd,
        suggestionMd: finding.suggestionMd ?? null,
        status: finding.status,
        createdAt: NOW,
      })
      .run();
  }
  const job = db.select().from(jobs).get()!;
  return { db, job };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  return { fn, fetchImpl: fn as unknown as typeof fetch };
}

function byTitle(db: ReturnType<typeof createTestDb>): Map<string, FindingRow> {
  return new Map(listFindings(db, 'j1').map((finding) => [finding.title, finding]));
}

describe('publisher', () => {
  it('publica inline, multi-linha e legado e move achados fora do diff para o corpo', async () => {
    const { db, job } = seed();
    const posts: PostedPayload[] = [];
    const { fn, fetchImpl } = mockFetch((url, init) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)) as PostedPayload);
        return jsonResponse({ id: 99, html_url: 'https://github.com/a/b/pull/7#pullrequestreview-99' });
      }
      expect(String(url)).toContain('/repos/a/b/pulls/7/reviews');
      return jsonResponse([]);
    });

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 1000 }, job, 'Resumo do review.');

    expect(result).toEqual({
      status: 'posted',
      reviewId: '99',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-99',
      commentsPosted: 3,
      commentsFallback: 1,
    });
    expect(fn.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.commit_id).toBe('sha1');
    expect(posts[0]!.event).toBe('COMMENT');
    expect(posts[0]!.comments).toEqual([
      { path: 'src/a.ts', line: 44, side: 'RIGHT', body: expect.stringContaining('[CRÍTICO] Bug') },
      {
        path: 'src/b.ts',
        start_line: 44,
        start_side: 'RIGHT',
        line: 46,
        side: 'RIGHT',
        body: expect.stringContaining('[MÉDIO] Intervalo'),
      },
      { path: 'src/d.ts', line: 50, side: 'RIGHT', body: expect.stringContaining('[PONTO FORTE] Legado') },
    ]);
    expect(posts[0]!.comments?.[0]!.body).toContain('**Sugestão:**');
    expect(posts[0]!.comments?.[0]!.body).toContain('fix()');

    expect(posts[0]!.body.startsWith(`${MARKER}\n\n`)).toBe(true);
    expect(posts[0]!.body).toContain('Resumo do review.');
    expect(posts[0]!.body).toContain('### Achados sem linha no diff');
    expect(posts[0]!.body).toContain('Fora');
    expect(posts[0]!.body).toContain('src/c.ts:10');
    expect(posts[0]!.body).not.toContain('src/a.ts');
    expect(posts[0]!.body).not.toContain('src/b.ts');
    expect(posts[0]!.body).not.toContain('src/d.ts');

    const reviewRow = db.select().from(reviews).get()!;
    expect(reviewRow).toMatchObject({
      jobId: 'j1',
      githubReviewId: '99',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-99',
      body: posts[0]!.body,
      event: 'COMMENT',
      commentsPosted: 3,
      commentsFallback: 1,
      status: 'posted',
      postedAt: 1000,
    });

    const findings = byTitle(db);
    expect(findings.get('Bug')).toMatchObject({ status: 'posted', reviewId: reviewRow.id });
    expect(findings.get('Intervalo')).toMatchObject({ status: 'posted', reviewId: reviewRow.id });
    expect(findings.get('Legado')).toMatchObject({ status: 'posted', reviewId: reviewRow.id });
    expect(findings.get('Fora')).toMatchObject({ status: 'fallback', reviewId: reviewRow.id });
  });

  it('não publica de novo quando o marcador já existe e atualiza a linha local', async () => {
    const { db, job } = seed();
    const remoteBody = `${MARKER}\n\nResumo antigo`;
    const { fn, fetchImpl } = mockFetch((_url, init) => {
      if (init?.method === 'POST') {
        throw new Error('POST inesperado');
      }
      return jsonResponse([
        { id: 4, body: 'review de outra execução', html_url: 'https://github.com/a/b/pull/7#pullrequestreview-4' },
        { id: 5, body: remoteBody, html_url: 'https://github.com/a/b/pull/7#pullrequestreview-5' },
      ]);
    });

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 2000 }, job, 'Resumo novo.');

    expect(result).toEqual({
      status: 'posted',
      reviewId: '5',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-5',
      commentsPosted: 3,
      commentsFallback: 1,
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);

    const reviewRow = db.select().from(reviews).get()!;
    expect(reviewRow).toMatchObject({
      jobId: 'j1',
      githubReviewId: '5',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-5',
      body: remoteBody,
      commentsPosted: 3,
      commentsFallback: 1,
      status: 'posted',
      postedAt: 2000,
    });

    const findings = byTitle(db);
    expect(findings.get('Bug')).toMatchObject({ status: 'posted', reviewId: reviewRow.id });
    expect(findings.get('Intervalo')).toMatchObject({ status: 'posted', reviewId: reviewRow.id });
    expect(findings.get('Legado')).toMatchObject({ status: 'posted', reviewId: reviewRow.id });
    expect(findings.get('Fora')).toMatchObject({ status: 'fallback', reviewId: reviewRow.id });
  });

  it('marcador com linha local mantém achado novo como valid e usa as contagens locais', async () => {
    const { db, job } = seed();
    const remoteBody = `${MARKER}\n\nResumo antigo`;
    db.insert(reviews)
      .values({
        id: 'local-5',
        jobId: 'j1',
        githubReviewId: '5',
        url: 'https://github.com/a/b/pull/7#pullrequestreview-5',
        body: remoteBody,
        event: 'COMMENT',
        commentsPosted: 2,
        commentsFallback: 1,
        status: 'posted',
        postedAt: 1000,
      })
      .run();
    const findings = byTitle(db);
    db.update(reviewFindings).set({ status: 'posted', reviewId: 'local-5' }).where(eq(reviewFindings.id, findings.get('Bug')!.id)).run();
    db.update(reviewFindings).set({ status: 'fallback', reviewId: 'local-5' }).where(eq(reviewFindings.id, findings.get('Fora')!.id)).run();
    db.insert(reviewFindings)
      .values({
        id: uuidv7(),
        jobId: 'j1',
        path: 'src/e.ts',
        startLine: 12,
        endLine: 12,
        side: 'RIGHT',
        severity: 'critical',
        title: 'Novo',
        bodyMd: 'corpo novo',
        status: 'valid',
        createdAt: NOW,
      })
      .run();
    const { fn, fetchImpl } = mockFetch((_url, init) => {
      if (init?.method === 'POST') {
        throw new Error('POST inesperado');
      }
      return jsonResponse([{ id: 5, body: remoteBody, html_url: 'https://github.com/a/b/pull/7#pullrequestreview-5' }]);
    });

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 2000 }, job, 'Resumo novo.');

    expect(result).toEqual({
      status: 'posted',
      reviewId: '5',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-5',
      commentsPosted: 2,
      commentsFallback: 1,
    });
    expect(fn.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true);
    const after = byTitle(db);
    expect(after.get('Novo')).toMatchObject({ status: 'valid', reviewId: null });
    expect(after.get('Intervalo')).toMatchObject({ status: 'valid', reviewId: null });
    expect(after.get('Legado')).toMatchObject({ status: 'valid', reviewId: null });
    expect(after.get('Bug')).toMatchObject({ status: 'posted', reviewId: 'local-5' });
    expect(after.get('Fora')).toMatchObject({ status: 'fallback', reviewId: 'local-5' });
    expect(db.select().from(reviews).get()).toMatchObject({
      id: 'local-5',
      commentsPosted: 2,
      commentsFallback: 1,
      status: 'posted',
      postedAt: 2000,
    });
  });

  it('republicação após sucesso encontra o marcador e mantém as contagens reais', async () => {
    const { db, job } = seed();
    let remote: unknown[] = [];
    let posts = 0;
    const { fetchImpl } = mockFetch((_url, init) => {
      if (init?.method === 'POST') {
        posts += 1;
        const payload = JSON.parse(String(init.body)) as PostedPayload;
        remote = [{ id: 99, body: payload.body, html_url: 'https://github.com/a/b/pull/7#pullrequestreview-99' }];
        return jsonResponse({ id: 99, html_url: 'https://github.com/a/b/pull/7#pullrequestreview-99' });
      }
      return jsonResponse(remote);
    });

    const first = await publishReview({ db, token: 't', fetchImpl, now: () => 1000 }, job, 'Resumo.');
    expect(first.status).toBe('posted');
    const localId = db.select().from(reviews).get()!.id;

    const second = await publishReview({ db, token: 't', fetchImpl, now: () => 3000 }, job, 'Resumo.');

    expect(posts).toBe(1);
    expect(second).toEqual({
      status: 'posted',
      reviewId: '99',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-99',
      commentsPosted: 3,
      commentsFallback: 1,
    });
    const rows = db.select().from(reviews).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(localId);
    expect(rows[0]!.postedAt).toBe(3000);
  });

  it('retry após linha failed atualiza a mesma review sem violar unicidade', async () => {
    const { db, job } = seed();
    db.insert(reviews)
      .values({
        id: 'local-failed',
        jobId: 'j1',
        githubReviewId: null,
        url: null,
        body: 'tentativa anterior',
        event: 'COMMENT',
        commentsPosted: 0,
        commentsFallback: 0,
        status: 'failed',
        postedAt: null,
      })
      .run();
    const { fetchImpl } = mockFetch((_url, init) => {
      if (init?.method === 'POST') {
        return jsonResponse({ id: 77, html_url: 'https://github.com/a/b/pull/7#pullrequestreview-77' });
      }
      return jsonResponse([]);
    });

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 1000 }, job, 'Resumo.');

    expect(result.status).toBe('posted');
    const rows = db.select().from(reviews).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'local-failed',
      githubReviewId: '77',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-77',
      commentsPosted: 3,
      commentsFallback: 1,
      status: 'posted',
      postedAt: 1000,
    });
    const findings = byTitle(db);
    expect(findings.get('Bug')).toMatchObject({ status: 'posted', reviewId: 'local-failed' });
    expect(findings.get('Intervalo')).toMatchObject({ status: 'posted', reviewId: 'local-failed' });
    expect(findings.get('Legado')).toMatchObject({ status: 'posted', reviewId: 'local-failed' });
    expect(findings.get('Fora')).toMatchObject({ status: 'fallback', reviewId: 'local-failed' });
  });

  it('422 republica sem comentários e move todos os achados para o corpo', async () => {
    const { db, job } = seed();
    const posts: PostedPayload[] = [];
    let postCount = 0;
    const { fetchImpl } = mockFetch((_url, init) => {
      if (init?.method === 'POST') {
        postCount += 1;
        posts.push(JSON.parse(String(init.body)) as PostedPayload);
        if (postCount === 1) {
          return new Response('posição inválida', { status: 422 });
        }
        return jsonResponse({ id: 100, html_url: 'https://github.com/a/b/pull/7#pullrequestreview-100' });
      }
      return jsonResponse([]);
    });

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 1000 }, job, 'Resumo.');

    expect(result).toEqual({
      status: 'fallback',
      reviewId: '100',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-100',
      commentsPosted: 0,
      commentsFallback: 4,
    });
    expect(posts).toHaveLength(2);
    expect(posts[0]!.comments).toHaveLength(3);
    expect(posts[1]!.comments).toBeUndefined();
    expect(posts[1]!.body.startsWith(`${MARKER}\n\n`)).toBe(true);
    expect(posts[1]!.body).toContain('### Achados sem linha no diff');
    expect(posts[1]!.body).toContain('Bug');
    expect(posts[1]!.body).toContain('src/a.ts:44');
    expect(posts[1]!.body).toContain('Intervalo');
    expect(posts[1]!.body).toContain('src/b.ts:46');
    expect(posts[1]!.body).toContain('Fora');
    expect(posts[1]!.body).toContain('src/c.ts:10');
    expect(posts[1]!.body).toContain('Legado');
    expect(posts[1]!.body).toContain('src/d.ts:50');

    const reviewRow = db.select().from(reviews).get()!;
    expect(reviewRow).toMatchObject({
      githubReviewId: '100',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-100',
      body: posts[1]!.body,
      commentsPosted: 0,
      commentsFallback: 4,
      status: 'fallback',
      postedAt: 1000,
    });
    for (const finding of listFindings(db, 'j1')) {
      expect(finding).toMatchObject({ status: 'fallback', reviewId: reviewRow.id });
    }
  });

  it('422 seguido de falha no fallback registra failed retryable', async () => {
    const { db, job } = seed();
    let postCount = 0;
    const { fetchImpl } = mockFetch((_url, init) => {
      if (init?.method === 'POST') {
        postCount += 1;
        return postCount === 1 ? new Response('posição inválida', { status: 422 }) : new Response('boom', { status: 500 });
      }
      return jsonResponse([]);
    });

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 1000 }, job, 'Resumo.');

    expect(result.status).toBe('failed');
    expect(result.retryable).toBe(true);
    expect(result.error).toContain('500');
    const rows = db.select().from(reviews).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'failed', githubReviewId: null, postedAt: null, commentsPosted: 0, commentsFallback: 0 });
    expect(rows[0]!.body).toContain(MARKER);
    expect(rows[0]!.body).toContain('Bug');
    expect(rows[0]!.body).toContain('Fora');

    const findings = byTitle(db);
    expect(findings.get('Bug')).toMatchObject({ status: 'valid', reviewId: null });
    expect(findings.get('Intervalo')).toMatchObject({ status: 'valid', reviewId: null });
    expect(findings.get('Legado')).toMatchObject({ status: 'valid', reviewId: null });
    expect(findings.get('Fora')).toMatchObject({ status: 'outside_diff', reviewId: null });
  });

  it('falha na listagem prévia registra failed retryable', async () => {
    const { db, job } = seed();
    const { fn, fetchImpl } = mockFetch(() => new Response('erro', { status: 500 }));

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 1000 }, job, 'Resumo.');

    expect(result.status).toBe('failed');
    expect(result.retryable).toBe(true);
    expect(result.error).toContain('GitHub 500');
    expect(fn.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    const reviewRow = db.select().from(reviews).get()!;
    expect(reviewRow).toMatchObject({ status: 'failed', githubReviewId: null, postedAt: null });
    expect(reviewRow.body.startsWith(`${MARKER}\n\n`)).toBe(true);
    expect(reviewRow.body).toContain('Resumo.');
    expect(reviewRow.body).toContain('### Achados sem linha no diff');
    expect(byTitle(db).get('Bug')).toMatchObject({ status: 'valid', reviewId: null });
  });

  it('preserva review posted quando a listagem prévia falha', async () => {
    const { db, job } = seed();
    const remoteBody = `${MARKER}\n\nResumo já publicado.`;
    db.insert(reviews)
      .values({
        id: 'local-posted',
        jobId: 'j1',
        githubReviewId: '42',
        url: 'https://github.com/a/b/pull/7#pullrequestreview-42',
        body: remoteBody,
        event: 'COMMENT',
        commentsPosted: 3,
        commentsFallback: 1,
        status: 'posted',
        postedAt: 1234,
      })
      .run();
    const { fn, fetchImpl } = mockFetch(() => new Response('erro', { status: 500 }));

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 9999 }, job, 'Resumo.');

    expect(result).toEqual({
      status: 'failed',
      reviewId: '42',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-42',
      commentsPosted: 3,
      commentsFallback: 1,
      retryable: true,
      error: expect.stringContaining('GitHub 500'),
    });
    expect(fn.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    const rows = db.select().from(reviews).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'local-posted',
      jobId: 'j1',
      githubReviewId: '42',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-42',
      body: remoteBody,
      commentsPosted: 3,
      commentsFallback: 1,
      status: 'posted',
      postedAt: 1234,
    });
    expect(byTitle(db).get('Bug')).toMatchObject({ status: 'valid', reviewId: null });
  });

  it('falha de rede na listagem prévia registra failed retryable', async () => {
    const { db, job } = seed();
    const { fetchImpl } = mockFetch(() => {
      throw new TypeError('fetch failed');
    });

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 1000 }, job, 'Resumo.');

    expect(result.status).toBe('failed');
    expect(result.retryable).toBe(true);
    expect(result.error).toContain('Falha de rede');
    expect(db.select().from(reviews).get()).toMatchObject({ status: 'failed', postedAt: null });
    expect(byTitle(db).get('Bug')).toMatchObject({ status: 'valid', reviewId: null });
  });

  it('falha 500 contínua na publicação registra failed retryable', async () => {
    const { db, job } = seed();
    const posts: PostedPayload[] = [];
    const { fetchImpl } = mockFetch((_url, init) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)) as PostedPayload);
        return new Response('boom', { status: 500 });
      }
      return jsonResponse([]);
    });

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 1000 }, job, 'Resumo.');

    expect(result.status).toBe('failed');
    expect(result.retryable).toBe(true);
    expect(result.error).toContain('GitHub 500');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.startsWith(`${MARKER}\n\n`)).toBe(true);
    expect(posts[0]!.comments).toHaveLength(3);
    const reviewRow = db.select().from(reviews).get()!;
    expect(reviewRow).toMatchObject({ status: 'failed', githubReviewId: null, url: null, postedAt: null });
    expect(reviewRow.body).toBe(posts[0]!.body);

    const findings = byTitle(db);
    expect(findings.get('Bug')).toMatchObject({ status: 'valid', reviewId: null });
    expect(findings.get('Intervalo')).toMatchObject({ status: 'valid', reviewId: null });
    expect(findings.get('Legado')).toMatchObject({ status: 'valid', reviewId: null });
    expect(findings.get('Fora')).toMatchObject({ status: 'outside_diff', reviewId: null });
  });

  it('sem achados publica review só com resumo e marcador', async () => {
    const { db, job } = seed([]);
    const posts: PostedPayload[] = [];
    const { fetchImpl } = mockFetch((_url, init) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)) as PostedPayload);
        return jsonResponse({ id: 9, html_url: 'https://github.com/a/b/pull/7#pullrequestreview-9' });
      }
      return jsonResponse([]);
    });

    const result = await publishReview({ db, token: 't', fetchImpl, now: () => 1000 }, job, 'Nenhum problema relevante.');

    expect(result).toEqual({
      status: 'posted',
      reviewId: '9',
      url: 'https://github.com/a/b/pull/7#pullrequestreview-9',
      commentsPosted: 0,
      commentsFallback: 0,
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.comments).toEqual([]);
    expect(posts[0]!.body.startsWith(`${MARKER}\n\n`)).toBe(true);
    expect(posts[0]!.body).toContain('Nenhum problema relevante.');
    expect(posts[0]!.body).not.toContain('Achados sem linha no diff');
    expect(db.select().from(reviewFindings).all()).toHaveLength(0);
    expect(db.select().from(reviews).get()).toMatchObject({
      status: 'posted',
      commentsPosted: 0,
      commentsFallback: 0,
      githubReviewId: '9',
    });
  });

  it('monta o corpo com marcador primeiro e seção de fallback', () => {
    const fallback: FindingRow = {
      id: 'f1',
      jobId: 'j1',
      reviewId: null,
      path: 'src/c.ts',
      startLine: 10,
      endLine: 10,
      side: 'RIGHT',
      severity: 'suggestion',
      title: 'Fora',
      bodyMd: 'corpo fora',
      suggestionMd: 'ajuste()',
      snippetJson: null,
      status: 'outside_diff',
      githubCommentId: null,
      createdAt: NOW,
    };
    const body = buildReviewBody(MARKER, 'Resumo.', [fallback]);
    expect(body.startsWith(`${MARKER}\n\n`)).toBe(true);
    expect(body).toContain('### Achados sem linha no diff');
    expect(body).toContain('`src/c.ts:10`');
    expect(body).toContain('**Sugestão:**');
    expect(body).toContain('ajuste()');
  });
});
