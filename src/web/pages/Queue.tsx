import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../api';
import { Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, StatCard, StatusBadge } from '../components/ui';
import { useMe } from '../components/ProtectedRoute';
import { useEvents } from '../hooks/useEvents';

type QueueData = { queued: number; running: number; paused: boolean; concurrency: number };
type JobRow = {
  id: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  repoFullName: string;
  status: string;
  runSeq: number;
  attempts: number;
  maxAttempts: number;
  priority: number;
  queuedAt: number;
  queuePosition: number | null;
};

const JOB_LIMIT = 50;

export function parsePrInput(value: string): { repoFullName: string; prNumber: number } | null {
  const trimmed = value.trim();
  const urlMatch = trimmed.match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  const shortMatch = trimmed.match(/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/);
  const match = urlMatch ?? shortMatch;
  if (!match) {
    return null;
  }
  const repoFullName = `${match[1]}/${match[2]}`;
  const prNumber = Number(match[3]);
  if (!Number.isInteger(prNumber) || prNumber <= 0) {
    return null;
  }
  return { repoFullName, prNumber };
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

export function Queue() {
  const queryClient = useQueryClient();
  const me = useMe();
  const canMutate = me.data?.role === 'operator' || me.data?.role === 'admin';
  const [input, setInput] = useState('');
  const [force, setForce] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  useEvents(refresh);

  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api<QueueData>('/api/queue') });
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api<{ jobs: JobRow[]; total: number }>(`/api/jobs?limit=${JOB_LIMIT}`),
  });

  const toggle = useMutation({
    mutationFn: (paused: boolean) => api(paused ? '/api/queue/resume' : '/api/queue/pause', { method: 'POST' }),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: () => setError('Não foi possível alterar o estado da fila.'),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api(`/api/jobs/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (mutationError) => setError(messageFor(mutationError, 'Não foi possível cancelar.')),
  });

  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/jobs/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (mutationError) => setError(messageFor(mutationError, 'Não foi possível reprocessar.')),
  });

  const rerun = useMutation({
    mutationFn: (job: JobRow) =>
      api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ repoFullName: job.repoFullName, prNumber: job.prNumber, force: true }),
      }),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (mutationError) => setError(messageFor(mutationError, 'Não foi possível iniciar uma nova execução.')),
  });

  const enqueue = useMutation({
    mutationFn: (parsed: { repoFullName: string; prNumber: number }) =>
      api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ ...parsed, force }),
      }),
    onSuccess: () => {
      setInput('');
      setForce(false);
      setError('');
      refresh();
    },
    onError: (mutationError) =>
      setError(messageFor(mutationError, 'Falha ao enfileirar (verifique o repo/PR ou use forçar).')),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    const parsed = parsePrInput(input);
    if (!parsed) {
      setError('Informe uma URL de PR do GitHub ou owner/repo#número.');
      return;
    }
    enqueue.mutate(parsed);
  }

  const runningJobs = (jobs.data?.jobs ?? [])
    .filter((job) => job.status === 'running')
    .sort((a, b) => a.queuedAt - b.queuedAt);
  const queuedJobs = (jobs.data?.jobs ?? [])
    .filter((job) => job.status === 'queued')
    .sort(
      (a, b) =>
        (a.queuePosition ?? Number.MAX_SAFE_INTEGER) - (b.queuePosition ?? Number.MAX_SAFE_INTEGER) ||
        b.priority - a.priority ||
        a.queuedAt - b.queuedAt,
    );
  const localPositionById = new Map(queuedJobs.map((job, index) => [job.id, index + 1]));
  const recentJobs = (jobs.data?.jobs ?? [])
    .filter((job) => job.status !== 'running' && job.status !== 'queued')
    .sort((a, b) => b.queuedAt - a.queuedAt);
  const orderedJobs = [...runningJobs, ...queuedJobs, ...recentJobs];
  const totalQueued = queue.data?.queued ?? queuedJobs.length;
  const currentRunning = runningJobs[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fila"
        subtitle="Execução FIFO, uma PR por vez"
        actions={
          canMutate ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => toggle.mutate(queue.data?.paused ?? false)}
              disabled={toggle.isPending || !queue.data}
            >
              {queue.data?.paused ? 'Retomar' : 'Pausar'}
            </Button>
          ) : (
            <span className="rounded-full bg-[var(--sunken)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
              somente leitura
            </span>
          )
        }
      />

      <ErrorText>{error}</ErrorText>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Na fila" value={queue.data?.queued ?? '—'} hint="aguardando worker" />
        <StatCard
          label="Em execução"
          value={queue.data?.running ?? '—'}
          hint={currentRunning ? `PR #${currentRunning.prNumber} · ${currentRunning.repoFullName}` : 'nenhuma PR em execução'}
        />
        <StatCard label="Concorrência" value={queue.data?.concurrency ?? '—'} hint="limite simultâneo" />
      </div>

      {canMutate ? (
        <Card title="Enfileirar PR">
          <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Field label="PR ou URL">
                <Input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="https://github.com/owner/repo/pull/123 ou owner/repo#123"
                />
              </Field>
            </div>
            <label className="mb-3 flex items-center gap-2 text-sm text-[var(--text)]">
              <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
              Forçar
            </label>
            <div className="mb-3">
              <Button type="submit" disabled={enqueue.isPending || input.trim().length === 0}>
                {enqueue.isPending ? 'Enfileirando…' : 'Enfileirar'}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card title="Jobs">
        {jobs.isError ? <p className="text-sm text-[var(--danger)]">Falha ao carregar os jobs.</p> : null}
        {jobs.isLoading ? (
          <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
        ) : jobs.data && jobs.data.jobs.length === 0 ? (
          <EmptyState>Nenhum job ainda. Eles aparecerão quando um review for solicitado à conta configurada.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  <th className="py-2 font-medium">PR</th>
                  <th className="py-2 font-medium">Repositório</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Tentativas</th>
                  <th className="py-2 font-medium">Posição</th>
                  {canMutate ? <th className="py-2 font-medium">Ações</th> : null}
                </tr>
              </thead>
              <tbody>
                {orderedJobs.map((job) => {
                  const position =
                    job.status === 'queued' ? (job.queuePosition ?? localPositionById.get(job.id) ?? null) : null;
                  return (
                    <tr key={job.id} className="border-t border-[var(--border)]">
                      <td className="py-2">
                        <a
                          className="text-[var(--link)] underline-offset-2 hover:underline"
                          href={job.prUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          #{job.prNumber} {job.prTitle}
                        </a>
                      </td>
                      <td className="py-2 text-[var(--text)]">{job.repoFullName || '—'}</td>
                      <td className="py-2">
                        <StatusBadge status={job.status} kind="job" />
                      </td>
                      <td className="py-2 text-[var(--text)]">
                        {job.attempts} / {job.maxAttempts}
                      </td>
                      <td className="py-2 text-[var(--text)]">
                        {position === null ? '—' : `${position} de ${totalQueued}`}
                      </td>
                      {canMutate ? (
                        <td className="py-2">
                          <span className="flex flex-wrap gap-2">
                            {job.status === 'queued' || job.status === 'running' ? (
                              <Button
                                type="button"
                                variant="danger"
                                className="px-2 py-1 text-xs"
                                onClick={() => cancel.mutate(job.id)}
                                disabled={cancel.isPending}
                              >
                                Cancelar
                              </Button>
                            ) : null}
                            {job.status === 'failed' || job.status === 'cancelled' ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="px-2 py-1 text-xs"
                                onClick={() => retry.mutate(job.id)}
                                disabled={retry.isPending}
                              >
                                Reprocessar
                              </Button>
                            ) : null}
                            {job.status !== 'queued' && job.status !== 'running' ? (
                              <Button
                                type="button"
                                variant="secondary"
                                className="px-2 py-1 text-xs"
                                onClick={() => rerun.mutate(job)}
                                disabled={rerun.isPending}
                              >
                                Nova execução
                              </Button>
                            ) : null}
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
