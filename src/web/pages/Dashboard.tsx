import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, EmptyState, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { useMe } from '../components/ProtectedRoute';
import { useEvents } from '../hooks/useEvents';
import { formatDuration, formatPercent, formatRelativeTime, formatTokens } from '../format';

type DashboardData = {
  queue: { queued: number; running: number; paused: boolean; concurrency: number };
  reviews: { total: number; last24h: number; last7d: number };
  failures: number;
  failuresLast7d: number;
  failureRate7d: number;
  tokens: { input: number; output: number; last7dInput: number; last7dOutput: number };
  avgDurationSec7d: number | null;
  current: {
    id: string;
    prNumber: number;
    prTitle: string;
    prUrl: string;
    repoFullName: string;
    queuedAt: number;
    startedAt: number | null;
  } | null;
  liveQueue: Array<{
    id: string;
    prNumber: number;
    prTitle: string;
    prUrl: string;
    repoFullName: string;
    status: 'queued' | 'running';
    queuedAt: number;
    startedAt: number | null;
  }>;
  recentReviews: Array<{
    id: string;
    jobId: string;
    prNumber: number;
    prTitle: string;
    repoFullName: string;
    status: string;
    commentsPosted: number;
    postedAt: number | null;
    critical: number;
    medium: number;
    suggestion: number;
  }>;
  findings: {
    critical: number;
    medium: number;
    suggestion: number;
    strength: number;
    total: number;
    topRepositories: Array<{ fullName: string; count: number }>;
  };
  trends: Array<{ date: string; reviews: number; failures: number; tokens: number }>;
  health: {
    pollerPaused: boolean;
    queuePaused: boolean;
    pollAuthFailures: number;
    lastPollAt: number | null;
    webhookFailures24h: number;
  };
  onboarding: { githubConfigured: boolean; activeProfile: boolean; pollingEnabled: boolean };
};

type SeverityCounts = { critical: number; medium: number; suggestion: number };

function plural(value: number, singular: string, pluralForm: string): string {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function severitySummary(counts: SeverityCounts): string {
  const parts: string[] = [];
  if (counts.critical > 0) {
    parts.push(plural(counts.critical, 'crítico', 'críticos'));
  }
  if (counts.medium > 0) {
    parts.push(plural(counts.medium, 'médio', 'médios'));
  }
  if (counts.suggestion > 0) {
    parts.push(plural(counts.suggestion, 'sugestão', 'sugestões'));
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
}

function HealthStatus({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span className={`font-medium ${ok ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>{children}</span>
  );
}

export function Dashboard() {
  const queryClient = useQueryClient();
  const me = useMe();
  useEvents(() => {
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  });
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/api/dashboard') });
  const data = dashboard.data;
  const loading = dashboard.isLoading;
  const current = data?.current ?? null;
  const liveQueue = data?.liveQueue ?? [];
  const recentReviews = data?.recentReviews ?? [];
  const trends = data?.trends ?? [];
  const health = data?.health;
  const onboarding = data?.onboarding;
  const onboardingPending =
    onboarding !== undefined &&
    (!onboarding.githubConfigured || !onboarding.activeProfile || !onboarding.pollingEnabled);
  const showOnboarding = me.data?.role === 'admin' && onboardingPending;
  const maxTrend = Math.max(1, ...trends.map((trend) => trend.reviews));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Fila, execuções e consumo"
        actions={
          <>
            {dashboard.isFetching ? (
              <span aria-live="polite" className="text-xs text-[var(--text-muted)]">
                Atualizando…
              </span>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => void dashboard.refetch()}
              disabled={dashboard.isFetching}
            >
              Atualizar
            </Button>
          </>
        }
      />

      {dashboard.isError ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          Falha ao carregar o dashboard.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Na fila"
          value={loading ? '—' : (data?.queue.queued ?? '—')}
          hint={`Concorrência: ${data?.queue.concurrency ?? '—'}`}
        />
        <StatCard
          label="Em execução"
          value={loading ? '—' : (data?.queue.running ?? '—')}
          hint={current ? `PR #${current.prNumber} · ${current.repoFullName}` : 'Nenhuma PR em execução'}
        />
        <StatCard
          label="Reviews (24 h)"
          value={loading ? '—' : (data?.reviews.last24h ?? '—')}
          hint={`${data?.reviews.total ?? '—'} no total`}
        />
        <StatCard
          label="Falhas"
          value={loading ? '—' : (data?.failures ?? '—')}
          hint={`${data?.failuresLast7d ?? '—'} nos últimos 7 dias`}
          tone={data && data.failures > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tokens (7 dias)"
          value={data ? formatTokens(data.tokens.last7dInput + data.tokens.last7dOutput) : '—'}
          hint={data ? `${formatTokens(data.tokens.last7dInput)} in · ${formatTokens(data.tokens.last7dOutput)} out` : 'Sem dados'}
        />
        <StatCard
          label="Duração média (7 dias)"
          value={data?.avgDurationSec7d === null || data?.avgDurationSec7d === undefined ? '—' : formatDuration(data.avgDurationSec7d)}
          hint="Jobs concluídos nos últimos 7 dias"
        />
        <StatCard
          label="Taxa de falha (7 dias)"
          value={data ? formatPercent(data.failureRate7d) : '—'}
          hint="Falhas sobre execuções concluídas"
          tone={data && data.failureRate7d > 0 ? 'warning' : 'neutral'}
        />
        <StatCard
          label="Achados por severidade"
          value={data?.findings.total ?? '—'}
          hint={
            data
              ? severitySummary({
                  critical: data.findings.critical,
                  medium: data.findings.medium,
                  suggestion: data.findings.suggestion,
                })
              : 'Sem dados'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Execução atual">
          {dashboard.isError ? (
            <p className="text-sm text-[var(--danger)]">Falha ao carregar a execução.</p>
          ) : loading ? (
            <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
          ) : current ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status="running" />
                <a
                  className="text-sm font-medium text-[var(--link)] underline-offset-2 hover:underline"
                  href={current.prUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  #{current.prNumber} {current.prTitle}
                </a>
              </div>
              <p className="text-sm text-[var(--text-muted)]">{current.repoFullName}</p>
              <p className="text-xs text-[var(--text-muted)]">
                {current.startedAt === null ? 'Aguardando início' : `Iniciada ${formatRelativeTime(current.startedAt)}`}
              </p>
            </div>
          ) : (
            <EmptyState>Nenhuma execução em andamento.</EmptyState>
          )}
        </Card>

        <Card title="Fila ao vivo">
          <div className="mb-2 flex justify-end">
            <Link className="text-xs text-[var(--link)] underline-offset-2 hover:underline" to="/queue">
              Ver fila
            </Link>
          </div>
          {dashboard.isError ? (
            <p className="text-sm text-[var(--danger)]">Falha ao carregar a fila.</p>
          ) : loading ? (
            <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
          ) : liveQueue.length === 0 ? (
            <EmptyState>Nenhuma PR aguardando na fila.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {liveQueue.slice(0, 6).map((job) => (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0">
                    <a
                      className="block truncate font-medium text-[var(--text)] underline-offset-2 hover:underline"
                      href={job.prUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      #{job.prNumber} {job.prTitle}
                    </a>
                    <span className="text-xs text-[var(--text-muted)]">{job.repoFullName}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={job.status} kind="job" />
                    <span className="text-xs text-[var(--text-muted)]">
                      {formatRelativeTime(job.startedAt ?? job.queuedAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Reviews recentes">
          <div className="mb-2 flex justify-end">
            <Link className="text-xs text-[var(--link)] underline-offset-2 hover:underline" to="/reviews">
              Ver todas
            </Link>
          </div>
          {dashboard.isError ? (
            <p className="text-sm text-[var(--danger)]">Falha ao carregar as reviews recentes.</p>
          ) : loading ? (
            <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
          ) : recentReviews.length === 0 ? (
            <EmptyState>Nenhuma review publicada ainda.</EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {recentReviews.slice(0, 5).map((review) => (
                <li key={review.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      className="font-medium text-[var(--text)] underline-offset-2 hover:underline"
                      to={`/reviews/${review.id}`}
                    >
                      #{review.prNumber} {review.prTitle}
                    </Link>
                    <StatusBadge status={review.status} kind="review" />
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    <span>{review.repoFullName}</span>
                    <span>·</span>
                    <span>{severitySummary(review)}</span>
                    <span>·</span>
                    <span>{plural(review.commentsPosted, 'comentário', 'comentários')}</span>
                    {review.postedAt !== null ? (
                      <>
                        <span>·</span>
                        <span>{formatRelativeTime(review.postedAt)}</span>
                      </>
                    ) : null}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Saúde operacional">
          {dashboard.isError ? (
            <p className="text-sm text-[var(--danger)]">Falha ao carregar a saúde operacional.</p>
          ) : health ? (
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--text-muted)]">Poller</dt>
                <dd>
                  <HealthStatus ok={!health.pollerPaused}>{health.pollerPaused ? 'Pausado' : 'Ativo'}</HealthStatus>
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Fila</dt>
                <dd>
                  <HealthStatus ok={!health.queuePaused}>{health.queuePaused ? 'Pausada' : 'Ativa'}</HealthStatus>
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Falhas de autenticação</dt>
                <dd className={health.pollAuthFailures > 0 ? 'text-[var(--danger)]' : 'text-[var(--text)]'}>
                  {health.pollAuthFailures}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Último poll</dt>
                <dd className="text-[var(--text)]">
                  {health.lastPollAt === null ? 'Nunca' : formatRelativeTime(health.lastPollAt)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Webhooks com falha</dt>
                <dd className={health.webhookFailures24h > 0 ? 'text-[var(--danger)]' : 'text-[var(--text)]'}>
                  {health.webhookFailures24h} <span className="text-[var(--text-muted)]">últimas 24 h</span>
                </dd>
              </div>
            </dl>
          ) : loading ? (
            <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
          ) : (
            <EmptyState>Sem dados de saúde.</EmptyState>
          )}
        </Card>
      </div>

      <Card title="Consumo e tendências">
        {dashboard.isError ? (
          <p className="text-sm text-[var(--danger)]">Falha ao carregar as tendências.</p>
        ) : trends.length === 0 ? (
          <EmptyState>Sem dados de tendências.</EmptyState>
        ) : (
          <div className="space-y-3">
            <div
              role="list"
              aria-label="Tendência de reviews dos últimos 7 dias"
              className="flex items-end gap-2 sm:gap-3"
            >
              {trends.map((trend) => (
                <div key={trend.date} role="listitem" className="flex min-w-0 flex-1 flex-col items-center gap-1">
                  <span className="text-xs text-[var(--text-muted)]">{trend.reviews}</span>
                  <div className="flex h-28 w-full items-end rounded bg-[var(--sunken)]">
                    <div
                      data-testid="trend-bar"
                      title={`${dayLabel(trend.date)} · ${plural(trend.reviews, 'review', 'reviews')} · ${plural(trend.failures, 'falha', 'falhas')} · ${formatTokens(trend.tokens)} tokens`}
                      className="w-full rounded-t bg-[var(--primary)]"
                      style={{ height: `${Math.max(2, Math.round((trend.reviews / maxTrend) * 100))}%` }}
                    />
                  </div>
                  <span className="text-xs text-[var(--text-muted)]">{dayLabel(trend.date)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              {plural(data?.reviews.last7d ?? 0, 'review', 'reviews')} em 7 dias ·{' '}
              {formatTokens((data?.tokens.last7dInput ?? 0) + (data?.tokens.last7dOutput ?? 0))} tokens ·{' '}
              {plural(data?.failuresLast7d ?? 0, 'falha', 'falhas')}
            </p>
          </div>
        )}
      </Card>

      {showOnboarding && onboarding ? (
        <Card title="Primeiros passos">
          <ul className="space-y-2 text-sm">
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[var(--text)]">Credencial GitHub</span>
              <span className="flex items-center gap-2">
                <span className={onboarding.githubConfigured ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                  {onboarding.githubConfigured ? 'Configurada' : 'Pendente'}
                </span>
                {onboarding.githubConfigured ? null : (
                  <Link className="text-[var(--link)] underline-offset-2 hover:underline" to="/settings/github">
                    Configurar GitHub
                  </Link>
                )}
              </span>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[var(--text)]">Perfil de IA ativo</span>
              <span className="flex items-center gap-2">
                <span className={onboarding.activeProfile ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                  {onboarding.activeProfile ? 'Configurado' : 'Pendente'}
                </span>
                {onboarding.activeProfile ? null : (
                  <Link className="text-[var(--link)] underline-offset-2 hover:underline" to="/settings/ia">
                    Configurar perfil
                  </Link>
                )}
              </span>
            </li>
            <li className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[var(--text)]">Polling habilitado</span>
              <span className="flex items-center gap-2">
                <span className={onboarding.pollingEnabled ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>
                  {onboarding.pollingEnabled ? 'Habilitado' : 'Pendente'}
                </span>
                {onboarding.pollingEnabled ? null : (
                  <Link className="text-[var(--link)] underline-offset-2 hover:underline" to="/settings/sistema">
                    Configurar sistema
                  </Link>
                )}
              </span>
            </li>
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
