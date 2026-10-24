import { useQuery, type QueryKey } from '@tanstack/react-query';
import { api } from '../api';
import { Card } from '../components/ui';
import { useEvents } from '../hooks/useEvents';

type DashboardData = { queue: { queued: number; running: number }; reviews: { total: number; last24h: number }; failures: number };

const DASHBOARD_QUERIES: QueryKey[] = [['dashboard']];

export function Dashboard() {
  useEvents(DASHBOARD_QUERIES);
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: () => api<DashboardData>('/api/dashboard') });
  const data = dashboard.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Dashboard</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Fila, execuções e consumo</p>
      </div>
      {dashboard.isError ? <p className="text-sm text-[var(--link)]">Falha ao carregar o dashboard.</p> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Na fila">
          <p className="text-2xl font-semibold text-[var(--text)]">{data?.queue.queued ?? '—'}</p>
        </Card>
        <Card title="Em execução">
          <p className="text-2xl font-semibold text-[var(--text)]">{data?.queue.running ?? '—'}</p>
        </Card>
        <Card title="Reviews (24 h)">
          <p className="text-2xl font-semibold text-[var(--text)]">{data?.reviews.last24h ?? '—'}</p>
        </Card>
        <Card title="Falhas">
          <p className="text-2xl font-semibold text-[var(--text)]">{data?.failures ?? '—'}</p>
        </Card>
      </div>
    </div>
  );
}
