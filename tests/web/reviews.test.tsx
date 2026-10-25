// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Reviews } from '../../src/web/pages/Reviews';

const now = Date.now();

const row = {
  id: 'rev-1',
  jobId: 'job-1',
  githubReviewId: '77',
  url: 'https://github.com/acme/api/pull/482#review-77',
  body: 'Review',
  event: 'COMMENT',
  commentsPosted: 4,
  commentsFallback: 0,
  status: 'posted',
  postedAt: now - 720_000,
  repoFullName: 'acme/api',
  prNumber: 482,
  prTitle: 'fix: valida token antes do parse',
  critical: 1,
  medium: 2,
  suggestion: 0,
};

const failedRow = {
  ...row,
  id: 'rev-2',
  prNumber: 468,
  prTitle: 'chore: atualiza dependências',
  status: 'failed',
  commentsPosted: 0,
  postedAt: now - 1_800_000,
  critical: 0,
  medium: 0,
  suggestion: 0,
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function renderReviews() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Reviews />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === 'string' ? input : input.toString();
}

describe('Reviews', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lista reviews com links interno e do GitHub', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (requestUrl(input).startsWith('/api/reviews')) {
        return json({ reviews: [row], total: 1, page: 1, limit: 20 });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderReviews();

    expect(await screen.findByRole('heading', { name: 'Reviews' })).toBeInTheDocument();
    const internal = await screen.findByRole('link', { name: /fix: valida token antes do parse/ });
    expect(internal).toHaveAttribute('href', '/reviews/rev-1');
    const rowElement = screen.getByRole('row', { name: /#482/ });
    expect(within(rowElement).getByText('acme/api')).toBeInTheDocument();
    expect(within(rowElement).getByText('Publicada')).toBeInTheDocument();
    expect(within(rowElement).getByText('1 crítico · 2 médios')).toBeInTheDocument();
    expect(within(rowElement).getByText('4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'GitHub' })).toHaveAttribute('href', row.url);
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
  });

  it('aplica filtros e consulta a página com os parâmetros', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/reviews')) {
        const query = new URL(url, 'http://localhost').searchParams;
        if (query.get('status') === 'failed') {
          return json({ reviews: [failedRow], total: 1, page: 1, limit: 20 });
        }
        return json({ reviews: [row], total: 1, page: 1, limit: 20 });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderReviews();

    await screen.findByRole('link', { name: /fix: valida token antes do parse/ });
    await userEvent.type(screen.getByLabelText('Repositório'), 'acme/api');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'failed');
    await userEvent.selectOptions(screen.getByLabelText('Severidade'), 'critical');
    await userEvent.selectOptions(screen.getByLabelText('Período'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Atualizar' }));

    const failedRowElement = await screen.findByRole('row', { name: /#468/ });
    expect(within(failedRowElement).getByText('Falhou')).toBeInTheDocument();
    const filteredCall = fetchMock.mock.calls
      .map(([input]) => requestUrl(input))
      .filter((url) => url.includes('repoFullName=acme%2Fapi'))
      .at(-1);
    expect(filteredCall).toBeDefined();
    const query = new URL(filteredCall!, 'http://localhost').searchParams;
    expect(query.get('repoFullName')).toBe('acme/api');
    expect(query.get('status')).toBe('failed');
    expect(query.get('severity')).toBe('critical');
    expect(query.get('periodDays')).toBe('30');
    expect(query.get('page')).toBe('1');
    expect(query.get('limit')).toBe('20');
  });

  it('navega entre páginas mantendo os filtros', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/reviews')) {
        const query = new URL(url, 'http://localhost').searchParams;
        if (query.get('page') === '2') {
          return json({ reviews: [failedRow], total: 45, page: 2, limit: 20 });
        }
        return json({ reviews: [row], total: 45, page: 1, limit: 20 });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderReviews();

    expect(await screen.findByText(/Página 1 de 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(await screen.findByRole('row', { name: /#468/ })).toBeInTheDocument();
    expect(screen.getByText(/Página 2 de 3/)).toBeInTheDocument();
    const pageTwo = fetchMock.mock.calls
      .map(([input]) => requestUrl(input))
      .find((url) => url.includes('page=2'));
    expect(pageTwo).toBeDefined();

    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByRole('row', { name: /#482/ })).toBeInTheDocument();
    expect(screen.getByText(/Página 1 de 3/)).toBeInTheDocument();
  });

  it('mostra estado vazio quando não há reviews', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ reviews: [], total: 0, page: 1, limit: 20 })),
    );
    renderReviews();

    expect(await screen.findByText(/Nenhuma review ainda/)).toBeInTheDocument();
  });
});
