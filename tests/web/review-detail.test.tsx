// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReviewDetail } from '../../src/web/pages/ReviewDetail';

const payload = {
  review: {
    id: 'rev1',
    body: '<!-- pr-reviewer:job:j1 -->\n**Review técnico da PR #482**\n\nUm achado crítico.',
    url: 'https://github.com/acme/repo/pull/482',
    status: 'posted',
    commentsPosted: 1,
    commentsFallback: 0,
    postedAt: 1,
  },
  job: {
    id: 'j1',
    prTitle: 'fix: valida token',
    prUrl: 'https://github.com/acme/repo/pull/482',
    headSha: 'sha1234567',
    status: 'succeeded',
    attempts: 1,
    maxAttempts: 3,
    startedAt: 1_000,
    finishedAt: 203_000,
    usageJson: JSON.stringify({ input: 100, output: 20, turns: 4, githubCalls: 7 }),
  },
  repository: { id: 'repo1', owner: 'acme', name: 'repo', fullName: 'acme/repo' },
  profile: { id: 'p1', name: 'Principal', provider: 'openai_compatible', model: 'gpt-5-mini' },
  events: [
    { id: 'e1', jobId: 'j1', level: 'info', type: 'job.started', message: 'Job iniciado', dataJson: null, createdAt: 2_000 },
    { id: 'e2', jobId: 'j1', level: 'info', type: 'review.published', message: 'Review publicada', dataJson: null, createdAt: 3_000 },
  ],
  findings: [
    {
      id: 'f1',
      path: 'src/a.ts',
      endLine: 41,
      severity: 'critical',
      title: 'Bug',
      bodyMd: 'Corpo com **ênfase**.',
      suggestionMd: 'fix()',
      status: 'posted',
      snippetJson: JSON.stringify({
        lines: [{ type: 'add', oldLine: null, newLine: 41, text: 'const now = Date.now();' }],
        targetLine: 41,
      }),
    },
    {
      id: 'f2',
      path: 'src/a.ts',
      endLine: 88,
      severity: 'medium',
      title: 'Falha de retry',
      bodyMd: 'Sem retry.',
      suggestionMd: null,
      status: 'posted',
      snippetJson: null,
    },
    {
      id: 'f3',
      path: 'src/b.ts',
      endLine: 10,
      severity: 'suggestion',
      title: 'Nome mais claro',
      bodyMd: 'Renomeie.',
      suggestionMd: null,
      status: 'posted',
      snippetJson: null,
    },
  ],
  transcript: [],
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/reviews/rev1']}>
        <Routes>
          <Route path="/reviews/:id" element={<ReviewDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubJson(data: unknown, status = 200, role: 'admin' | 'operator' | 'viewer' = 'admin') {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === '/api/auth/me') {
      return json({ user: { id: 'u1', username: role, role, isRoot: role === 'admin' } });
    }
    return json(data, status);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ReviewDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renderiza cabeçalho, corpo sem marcador, achados agrupados e timeline', async () => {
    stubJson(payload);
    renderDetail();

    expect(await screen.findByText('Review técnico da PR #482')).toBeInTheDocument();
    expect(screen.queryByText(/pr-reviewer:job/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Reviews' })).toHaveAttribute('href', '/reviews');
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    expect(screen.getAllByText('[CRÍTICO]').length).toBeGreaterThan(0);
    expect(screen.getByText('acme/repo')).toBeInTheDocument();
    expect(screen.getByText('Principal · openai_compatible · gpt-5-mini')).toBeInTheDocument();
    expect(screen.getByText('3 min')).toBeInTheDocument();
    expect(screen.getByText('100 in · 20 out')).toBeInTheDocument();
    expect(screen.getByText('7 chamadas')).toBeInTheDocument();
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('const now = Date.now();')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'src/a.ts (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'src/b.ts (1)' })).toBeInTheDocument();
    expect(screen.getByText('Job iniciado')).toBeInTheDocument();
    expect(screen.getByText('Review publicada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Republicar' })).toBeInTheDocument();
  });

  it('não quebra com JSON inválido e mostra o aviso de fallback', async () => {
    stubJson({
      ...payload,
      review: { ...payload.review, body: 'Corpo do fallback', status: 'fallback' },
      job: { ...payload.job, status: 'running', usageJson: '{invalido' },
      findings: [{ ...payload.findings[0], snippetJson: '{tambem invalido' }],
    });
    renderDetail();

    expect(await screen.findByText('Corpo do fallback')).toBeInTheDocument();
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText(/Publicado com fallback/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Republicar' })).not.toBeInTheDocument();
  });

  it('tolera job, repository, profile, events e achados nulos', async () => {
    stubJson({ ...payload, job: null, repository: null, profile: null, events: null, findings: null, transcript: null });
    renderDetail();

    expect(await screen.findByText('Review técnico da PR #482')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Republicar' })).not.toBeInTheDocument();
  });

  it('mostra erro quando a review não existe', async () => {
    stubJson({ error: { code: 'review_not_found', message: 'Review não encontrada' } }, 404);
    renderDetail();

    expect(await screen.findByRole('alert')).toHaveTextContent('Review não encontrada');
  });

  it('esconde republicar para viewer mesmo em job terminal', async () => {
    stubJson(payload, 200, 'viewer');
    renderDetail();

    expect(await screen.findByText('Review técnico da PR #482')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Republicar' })).not.toBeInTheDocument();
  });

  it('mostra erro ao falhar a republicação', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/auth/me') {
        return json({ user: { id: 'u1', username: 'admin', role: 'admin', isRoot: true } });
      }
      if (url === '/api/reviews/rev1' && method === 'GET') {
        return json(payload);
      }
      if (url === '/api/jobs/j1/publish-review' && method === 'POST') {
        return json({ error: { code: 'github_token_missing', message: 'Credencial GitHub ausente' } }, 400);
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Republicar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credencial GitHub ausente');
  });
});
