import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { api } from '../api';
import { Button, Card, EmptyState } from '../components/ui';
import { useEvents } from '../hooks/useEvents';

type QueueData = { queued: number; running: number; paused: boolean };
type JobRow = { id: string; prTitle: string; prUrl: string; status: string; runSeq: number; queuedAt: number };

const QUEUE_QUERIES: QueryKey[] = [['queue'], ['jobs']];

export function Queue() {
  useEvents(QUEUE_QUERIES);
  const queryClient = useQueryClient();
  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api<QueueData>('/api/queue') });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<{ jobs: JobRow[] }>('/api/jobs') });
  const toggle = useMutation({
    mutationFn: (paused: boolean) => api(paused ? '/api/queue/resume' : '/api/queue/pause', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queue'] }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Fila</h1>
        <p className="mt-1 text-sm text-slate-400">Execução FIFO, uma PR por vez</p>
      </div>
      <Card title="Fila">
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm text-slate-400">
            Na fila: <span className="text-slate-200">{queue.data?.queued ?? '—'}</span> · Em execução:{' '}
            <span className="text-slate-200">{queue.data?.running ?? '—'}</span>
            {queue.data?.paused ? <span className="ml-2 rounded-full bg-amber-950 px-2 py-0.5 text-xs text-amber-300">pausada</span> : null}
          </p>
          <Button type="button" onClick={() => toggle.mutate(queue.data?.paused ?? false)} disabled={toggle.isPending}>
            {queue.data?.paused ? 'Retomar' : 'Pausar'}
          </Button>
        </div>
      </Card>
      <Card title="Jobs">
        {jobs.isError ? <p className="text-sm text-red-400">Falha ao carregar os jobs.</p> : null}
        {jobs.data && jobs.data.jobs.length === 0 ? (
          <EmptyState>Nenhum job ainda. Eles aparecerão quando um review for solicitado à conta configurada.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-800 text-sm">
            {jobs.data?.jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a className="text-sky-400 underline-offset-2 hover:underline" href={job.prUrl}>
                  {job.prTitle}
                </a>
                <span className="text-slate-500">
                  {job.status} · run {job.runSeq}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
