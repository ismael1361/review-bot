// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Queue, parsePrInput } from '../../src/web/pages/Queue';

const now = Date.now();

const jobs = [
  {
    id: 'j-run',
    prNumber: 482,
    prTitle: 'fix: valida token antes do parse',
    prUrl: 'https://github.com/acme/api/pull/482',
    repoFullName: 'acme/api',
    status: 'running',
    runSeq: 1,
    attempts: 1,
    maxAttempts: 3,
    priority: 0,
    queuedAt: now - 300_000,
    queuePosition: null,
  },
  {
    id: 'j-q1',
    prNumber: 479,
    prTitle: 'feat: adiciona cache de ETag',
    prUrl: 'https://github.com/acme/api/pull/479',
    repoFullName: 'acme/api',
    status: 'queued',
    runSeq: 1,
    attempts: 0,
    maxAttempts: 3,
    priority: 0,
    queuedAt: now - 200_000,
    queuePosition: 1,
  },
  {
    id: 'j-q2',
    prNumber: 477,
    prTitle: 'refactor: extrai publisher',
    prUrl: 'https://github.com/acme/web/pull/477',
    repoFullName: 'acme/web',
    status: 'queued',
    runSeq: 1,
    attempts: 0,
    maxAttempts: 3,
    priority: 0,
    queuedAt: now - 100_000,
    queuePosition: 2,
  },
  {
    id: 'j-failed',
    prNumber: 468,
    prTitle: 'chore: atualiza dependências',
    prUrl: 'https://github.com/acme/web/pull/468',
    repoFullName: 'acme/web',
    status: 'failed',
    runSeq: 1,
    attempts: 3,
    maxAttempts: 3,
    priority: 0,
    queuedAt: now - 900_000,
    queuePosition: null,
  },
  {
    id: 'j-done',
    prNumber: 471,
    prTitle: 'docs: guia de deploy',
    prUrl: 'https://github.com/acme/infra/pull/471',
    repoFullName: 'acme/infra',
    status: 'succeeded',
    runSeq: 1,
    attempts: 1,
    maxAttempts: 3,
    priority: 0,
    queuedAt: now - 1_200_000,
    queuePosition: null,
  },
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function requestUrl(input: RequestInfo | URL) {
  return typeof input === 'string' ? input : input.toString();
}

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Queue />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubQueue(
  role: 'admin' | 'operator' | 'viewer' = 'admin',
  overrides: { queued?: number; jobs?: typeof jobs } = {},
) {
  const jobRows = overrides.jobs ?? jobs;
  let paused = false;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/auth/me') {
      return json({ user: { id: 'u1', username: role, role, isRoot: role === 'admin' } });
    }
    if (url === '/api/queue' && method === 'GET') {
      return json({
        queued: overrides.queued ?? jobRows.filter((job) => job.status === 'queued').length,
        running: jobRows.filter((job) => job.status === 'running').length,
        paused,
        concurrency: 2,
      });
    }
    if (url === '/api/queue/pause' && method === 'POST') {
      paused = true;
      return json({ paused: true });
    }
    if (url === '/api/queue/resume' && method === 'POST') {
      paused = false;
      return json({ paused: false });
    }
    if (url.startsWith('/api/jobs?') && method === 'GET') {
      return json({ jobs: jobRows, total: jobRows.length, page: 1, limit: 50 });
    }
    if (url === '/api/jobs' && method === 'POST') {
      return json({ jobId: 'new-job' }, 201);
    }
    if (url.startsWith('/api/jobs/') && method === 'POST') {
      return new Response(null, { status: 204 });
    }
    return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('parsePrInput', () => {
  it('aceita URL do GitHub e owner/repo#número', () => {
    expect(parsePrInput('https://github.com/acme/api/pull/123')).toEqual({ repoFullName: 'acme/api', prNumber: 123 });
    expect(parsePrInput('https://github.com/acme/api/pull/123/files')).toEqual({ repoFullName: 'acme/api', prNumber: 123 });
    expect(parsePrInput('owner/repo#45')).toEqual({ repoFullName: 'owner/repo', prNumber: 45 });
  });

  it('rejeita entradas inválidas', () => {
    expect(parsePrInput('')).toBeNull();
    expect(parsePrInput('https://gitlab.com/acme/api/pull/1')).toBeNull();
    expect(parsePrInput('owner/repo')).toBeNull();
    expect(parsePrInput('https://github.com/acme/api/pull/0')).toBeNull();
  });
});

describe('Queue', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mostra fila, execução e concorrência com posições', async () => {
    stubQueue();
    renderQueue();

    expect(await screen.findByRole('heading', { name: 'Fila' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Na fila' })).toHaveTextContent('2');
    });
    expect(screen.getByRole('region', { name: 'Em execução' })).toHaveTextContent('1');
    expect(screen.getByRole('region', { name: 'Concorrência' })).toHaveTextContent('2');

    const firstQueued = screen.getByRole('row', { name: /#479/ });
    expect(within(firstQueued).getByText('1 de 2')).toBeInTheDocument();
    const secondQueued = screen.getByRole('row', { name: /#477/ });
    expect(within(secondQueued).getByText('2 de 2')).toBeInTheDocument();
  });

  it('usa a posição global, mostra o total truncado e ordena execução antes da fila', async () => {
    stubQueue('admin', {
      queued: 57,
      jobs: [jobs[0]!, { ...jobs[1]!, queuePosition: 57 }],
    });
    renderQueue();

    const truncated = await screen.findByRole('row', { name: /#479/ });
    expect(within(truncated).getByText('57 de 57')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]!).getByRole('link', { name: /fix: valida token antes do parse/ })).toBeInTheDocument();
  });

  it('enfileira a partir de uma URL do GitHub', async () => {
    const fetchMock = stubQueue();
    renderQueue();

    await screen.findByLabelText('PR ou URL');
    await userEvent.type(screen.getByLabelText('PR ou URL'), 'https://github.com/acme/api/pull/123');
    await userEvent.click(screen.getByRole('button', { name: 'Enfileirar' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => requestUrl(input) === '/api/jobs' && init?.method === 'POST')).toBe(true);
    });
    const call = fetchMock.mock.calls.find(([input, init]) => requestUrl(input) === '/api/jobs' && init?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      repoFullName: 'acme/api',
      prNumber: 123,
      force: false,
    });
  });

  it('enfileira owner/repo#número com forçar', async () => {
    const fetchMock = stubQueue();
    renderQueue();

    await screen.findByLabelText('PR ou URL');
    await userEvent.type(screen.getByLabelText('PR ou URL'), 'owner/repo#45');
    await userEvent.click(screen.getByLabelText('Forçar'));
    await userEvent.click(screen.getByRole('button', { name: 'Enfileirar' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input, init]) => requestUrl(input) === '/api/jobs' && init?.method === 'POST')).toBe(true);
    });
    const call = fetchMock.mock.calls.find(([input, init]) => requestUrl(input) === '/api/jobs' && init?.method === 'POST');
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      repoFullName: 'owner/repo',
      prNumber: 45,
      force: true,
    });
  });

  it('rejeita entrada inválida sem enfileirar', async () => {
    const fetchMock = stubQueue();
    renderQueue();

    await screen.findByLabelText('PR ou URL');
    await userEvent.type(screen.getByLabelText('PR ou URL'), 'entrada inválida');
    await userEvent.click(screen.getByRole('button', { name: 'Enfileirar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Informe uma URL de PR do GitHub ou owner/repo#número.');
    expect(fetchMock.mock.calls.some(([input, init]) => requestUrl(input) === '/api/jobs' && init?.method === 'POST')).toBe(false);
  });

  it('cancela, reprocessa e inicia nova execução', async () => {
    const fetchMock = stubQueue();
    renderQueue();

    const runningRow = await screen.findByRole('row', { name: /#482/ });
    await userEvent.click(within(runningRow).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => requestUrl(input) === '/api/jobs/j-run/cancel' && init?.method === 'POST'),
      ).toBe(true);
    });

    const failedRow = screen.getByRole('row', { name: /#468/ });
    await userEvent.click(within(failedRow).getByRole('button', { name: 'Reprocessar' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => requestUrl(input) === '/api/jobs/j-failed/retry' && init?.method === 'POST'),
      ).toBe(true);
    });

    await userEvent.click(within(failedRow).getByRole('button', { name: 'Nova execução' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([input, init]) => requestUrl(input) === '/api/jobs' && init?.method === 'POST');
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        repoFullName: 'acme/web',
        prNumber: 468,
        force: true,
      });
    });
  });

  it('pausa e retoma a fila', async () => {
    const fetchMock = stubQueue();
    renderQueue();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Pausar' })).toBeEnabled();
    });
    await userEvent.click(screen.getByRole('button', { name: 'Pausar' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => requestUrl(input) === '/api/queue/pause' && init?.method === 'POST'),
      ).toBe(true);
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Retomar' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input, init]) => requestUrl(input) === '/api/queue/resume' && init?.method === 'POST'),
      ).toBe(true);
    });
  });

  it('viewer vê a fila em modo somente leitura', async () => {
    stubQueue('viewer');
    renderQueue();

    expect(await screen.findByRole('heading', { name: 'Fila' })).toBeInTheDocument();
    expect(await screen.findByRole('row', { name: /#482/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('PR ou URL')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enfileirar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprocessar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nova execução' })).not.toBeInTheDocument();
  });
});
