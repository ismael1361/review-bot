import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Card } from '../components/ui';
import { useEvents } from '../hooks/useEvents';

type DashboardData = {
  queue: { queued: number; running: number };
  reviews: { total: number; last24h: number; last7d?: number };
  failures: number;
  tokens?: { input: number; output: number };
};

function formatNumber(value: number | undefined): string {
  return value === undefined ? '—' : value.toLocaleString('pt-BR');
}

export function Dashboard() {
  const queryClient = useQueryClient();
  useEvents(() => {
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  });
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/api/dashboard') });
  const data = dashboard.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Fila, execuções e consumo</p>
      </div>
      {dashboard.isError ? <p className="text-sm text-[var(--danger)]">Falha ao carregar o dashboard.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Na fila">
          <p className="text-2xl font-semibold text-[var(--text)]">{data?.queue.queued ?? '—'}</p>
        </Card>
        <Card title="Em execução">
          <p className="text-2xl font-semibold text-[var(--text)]">{data?.queue.running ?? '—'}</p>
        </Card>
        <Card title="Reviews (24 h)">
          <p className="text-2xl font-semibold text-[var(--text)]">{data?.reviews.last24h ?? '—'}</p>
        </Card>
        <Card title="Reviews (7 dias)">
          <p className="text-2xl font-semibold text-[var(--text)]">{data?.reviews.last7d ?? '—'}</p>
        </Card>
        <Card title="Falhas">
          <p className="text-2xl font-semibold text-[var(--text)]">{data?.failures ?? '—'}</p>
        </Card>
        <Card title="Tokens">
          <p className="text-2xl font-semibold text-[var(--text)]">
            {data?.tokens ? `${formatNumber(data.tokens.input)} in` : '—'}
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {data?.tokens ? `${formatNumber(data.tokens.output)} out` : 'Sem dados de tokens'}
          </p>
        </Card>
      </div>
    </div>
  );
}
