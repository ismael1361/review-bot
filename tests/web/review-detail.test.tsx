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
    usageJson: JSON.stringify({ input: 100, output: 20, turns: 4 }),
  },
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
  ],
  transcript: [],
};

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

function stubJson(data: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data), { status })));
}

describe('ReviewDetail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renderiza corpo sem o marcador, achado e diff', async () => {
    stubJson(payload);
    renderDetail();

    expect(await screen.findByText('Review técnico da PR #482')).toBeInTheDocument();
    expect(screen.queryByText(/pr-reviewer:job/)).not.toBeInTheDocument();
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('const now = Date.now();')).toBeInTheDocument();
    expect(screen.getByText('100 in · 20 out')).toBeInTheDocument();
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

  it('tolera job e achados nulos', async () => {
    stubJson({ ...payload, job: null, findings: null, transcript: null });
    renderDetail();

    expect(await screen.findByText('Review técnico da PR #482')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Republicar' })).not.toBeInTheDocument();
  });

  it('mostra erro quando a review não existe', async () => {
    stubJson({ error: { code: 'review_not_found', message: 'Review não encontrada' } }, 404);
    renderDetail();

    expect(await screen.findByRole('alert')).toHaveTextContent('Review não encontrada');
  });

  it('mostra erro ao falhar a republicação', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/reviews/rev1' && method === 'GET') {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      if (url === '/api/jobs/j1/publish-review' && method === 'POST') {
        return new Response(JSON.stringify({ error: { code: 'github_token_missing', message: 'Credencial GitHub ausente' } }), {
          status: 400,
        });
      }
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Rota não encontrada' } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderDetail();

    await userEvent.click(await screen.findByRole('button', { name: 'Republicar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Credencial GitHub ausente');
  });
});
