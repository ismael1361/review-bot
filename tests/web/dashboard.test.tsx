// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Dashboard } from '../../src/web/pages/Dashboard';

const now = Date.now();

const dashboardData = {
  queue: { queued: 3, running: 1, paused: false, concurrency: 2 },
  reviews: { total: 42, last24h: 12, last7d: 30 },
  failures: 1,
  failuresLast7d: 2,
  failureRate7d: 0.125,
  tokens: { input: 5000, output: 2000, last7dInput: 128000, last7dOutput: 64000 },
  avgDurationSec7d: 202,
  current: {
    id: 'job-run',
    prNumber: 482,
    prTitle: 'fix: valida token antes do parse',
    prUrl: 'https://github.com/acme/api/pull/482',
    repoFullName: 'acme/api',
    queuedAt: now - 300_000,
    startedAt: now - 180_000,
  },
  liveQueue: [
    {
      id: 'job-run',
      prNumber: 482,
      prTitle: 'fix: valida token antes do parse',
      prUrl: 'https://github.com/acme/api/pull/482',
      repoFullName: 'acme/api',
      status: 'running',
      queuedAt: now - 300_000,
      startedAt: now - 180_000,
    },
    {
      id: 'job-q2',
      prNumber: 479,
      prTitle: 'feat: adiciona cache de ETag',
      prUrl: 'https://github.com/acme/api/pull/479',
      repoFullName: 'acme/api',
      status: 'queued',
      queuedAt: now - 240_000,
      startedAt: null,
    },
  ],
  recentReviews: [
    {
      id: 'rev-1',
      jobId: 'job-1',
      prNumber: 476,
      prTitle: 'fix: cache de ETag',
      repoFullName: 'acme/web',
      status: 'posted',
      commentsPosted: 4,
      postedAt: now - 720_000,
      critical: 1,
      medium: 2,
      suggestion: 0,
    },
  ],
  findings: {
    critical: 1,
    medium: 2,
    suggestion: 3,
    strength: 1,
    total: 7,
    topRepositories: [{ fullName: 'acme/api', count: 5 }],
  },
  trends: [
    { date: '2026-10-19', reviews: 1, failures: 0, tokens: 1200 },
    { date: '2026-10-20', reviews: 4, failures: 1, tokens: 6400 },
    { date: '2026-10-21', reviews: 2, failures: 0, tokens: 3200 },
    { date: '2026-10-22', reviews: 0, failures: 0, tokens: 0 },
    { date: '2026-10-23', reviews: 5, failures: 1, tokens: 9000 },
    { date: '2026-10-24', reviews: 3, failures: 0, tokens: 5100 },
    { date: '2026-10-25', reviews: 6, failures: 0, tokens: 12000 },
  ],
  health: {
    pollerPaused: false,
    queuePaused: true,
    pollAuthFailures: 0,
    lastPollAt: now - 120_000,
    webhookFailures24h: 2,
  },
  onboarding: { githubConfigured: true, activeProfile: false, pollingEnabled: false },
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubDashboard(role: 'admin' | 'operator' | 'viewer', data = dashboardData) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === '/api/auth/me') {
      return json({ user: { id: 'u1', username: role, role, isRoot: role === 'admin' } });
    }
    if (url === '/api/dashboard') {
      return json(data);
    }
    return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('Dashboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mostra cartões operacionais, fila ao vivo e reviews recentes', async () => {
    stubDashboard('admin');
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
    await screen.findByText('Concorrência: 2');

    const queueCard = screen.getByRole('region', { name: 'Na fila' });
    expect(within(queueCard).getByText('3')).toBeInTheDocument();
    expect(within(queueCard).getByText('Concorrência: 2')).toBeInTheDocument();

    const runningCard = screen.getByRole('region', { name: 'Em execução' });
    expect(within(runningCard).getByText('PR #482 · acme/api')).toBeInTheDocument();

    const reviewsCard = screen.getByRole('region', { name: 'Reviews (24 h)' });
    expect(within(reviewsCard).getByText('12')).toBeInTheDocument();

    const failuresCard = screen.getByRole('region', { name: 'Falhas' });
    expect(within(failuresCard).getByText('1')).toBeInTheDocument();
    expect(within(failuresCard).getByText('2 nos últimos 7 dias')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'Ver fila' })).toHaveAttribute('href', '/queue');
    expect(screen.getByRole('link', { name: /feat: adiciona cache de ETag/ })).toBeInTheDocument();
    expect(screen.getByText('Na fila', { selector: 'span' })).toBeInTheDocument();

    const reviewLink = screen.getByRole('link', { name: /fix: cache de ETag/ });
    expect(reviewLink).toHaveAttribute('href', '/reviews/rev-1');
    expect(screen.getByText('1 crítico · 2 médios')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver todas' })).toHaveAttribute('href', '/reviews');
  });

  it('mostra saúde operacional e sete barras de tendência', async () => {
    stubDashboard('admin');
    renderDashboard();

    expect(await screen.findByText('Saúde operacional')).toBeInTheDocument();
    expect(await screen.findByText('Poller')).toBeInTheDocument();
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('Pausada')).toBeInTheDocument();
    expect(screen.getByText('Falhas de autenticação')).toBeInTheDocument();
    expect(screen.getByText('últimas 24 h')).toBeInTheDocument();
    expect(screen.getByText('há 2 min')).toBeInTheDocument();

    expect(screen.getAllByTestId('trend-bar')).toHaveLength(7);
    expect(screen.getByRole('region', { name: 'Tokens (7 dias)' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Duração média (7 dias)' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Taxa de falha (7 dias)' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Achados por severidade' })).toBeInTheDocument();
  });

  it('mostra primeiros passos para admin quando há pendências', async () => {
    stubDashboard('admin');
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Primeiros passos' })).toBeInTheDocument();
    expect(screen.getByText('Perfil de IA ativo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configurar perfil' })).toHaveAttribute('href', '/settings/ia');
  });

  it('esconde primeiros passos quando tudo está configurado', async () => {
    stubDashboard('admin', {
      ...dashboardData,
      onboarding: { githubConfigured: true, activeProfile: true, pollingEnabled: true },
    });
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Primeiros passos' })).not.toBeInTheDocument();
  });

  it('não mostra primeiros passos para viewer', async () => {
    stubDashboard('viewer');
    renderDashboard();

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Primeiros passos' })).not.toBeInTheDocument();
  });
});
