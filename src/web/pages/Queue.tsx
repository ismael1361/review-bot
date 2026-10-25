import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../api';
import { Button, Card, EmptyState, ErrorText, Field, Input } from '../components/ui';
import { useEvents } from '../hooks/useEvents';

type QueueData = { queued: number; running: number; paused: boolean };
type JobRow = { id: string; prTitle: string; prUrl: string; status: string; runSeq: number; attempts: number };

export function Queue() {
  const queryClient = useQueryClient();
  const [repoFullName, setRepoFullName] = useState('');
  const [prNumber, setPrNumber] = useState('');
  const [force, setForce] = useState(false);
  const [error, setError] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['queue'] });
    void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  useEvents(refresh);

  const queue = useQuery({ queryKey: ['queue'], queryFn: () => api<QueueData>('/api/queue') });
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<{ jobs: JobRow[] }>('/api/jobs') });

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
    onError: (mutationError) =>
      setError(mutationError instanceof ApiRequestError ? mutationError.message : 'Não foi possível cancelar.'),
  });

  const retry = useMutation({
    mutationFn: (id: string) => api(`/api/jobs/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (mutationError) =>
      setError(mutationError instanceof ApiRequestError ? mutationError.message : 'Não foi possível reprocessar.'),
  });

  const prValue = Number(prNumber);
  const validPrNumber = Number.isInteger(prValue) && prValue > 0;
  const validRepo = repoFullName.trim().length > 0;

  const enqueue = useMutation({
    mutationFn: () =>
      api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({ repoFullName: repoFullName.trim(), prNumber: prValue, force }),
      }),
    onSuccess: () => {
      setRepoFullName('');
      setPrNumber('');
      setForce(false);
      setError('');
      refresh();
    },
    onError: (mutationError) =>
      setError(
        mutationError instanceof ApiRequestError
          ? mutationError.message
          : 'Falha ao enfileirar (verifique o repo/PR ou use forçar).',
      ),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!validRepo || !validPrNumber) {
      setError('Informe um repositório e um número de PR positivo.');
      return;
    }
    enqueue.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Fila</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Execução FIFO, uma PR por vez</p>
      </div>
      <ErrorText>{error}</ErrorText>
      <Card title="Fila">
        {queue.isError ? (
          <p className="text-sm text-[var(--danger)]">Falha ao carregar a fila.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <p className="text-sm text-[var(--text-muted)]">
              Na fila: <span className="text-[var(--text)]">{queue.data?.queued ?? '—'}</span> · Em execução:{' '}
              <span className="text-[var(--text)]">{queue.data?.running ?? '—'}</span>
              {queue.data?.paused ? (
                <span className="ml-2 rounded-full bg-[var(--secondary)] px-2 py-0.5 text-xs text-[var(--on-secondary)]">
                  pausada
                </span>
              ) : null}
            </p>
            <Button
              type="button"
              onClick={() => toggle.mutate(queue.data?.paused ?? false)}
              disabled={toggle.isPending || !queue.data}
            >
              {queue.data?.paused ? 'Retomar' : 'Pausar'}
            </Button>
          </div>
        )}
      </Card>
      <Card title="Enfileirar PR">
        <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Field label="Repositório (owner/repo)">
              <Input value={repoFullName} onChange={(event) => setRepoFullName(event.target.value)} placeholder="owner/repo" />
            </Field>
          </div>
          <div className="w-32">
            <Field label="PR">
              <Input
                value={prNumber}
                onChange={(event) => setPrNumber(event.target.value)}
                inputMode="numeric"
                placeholder="123"
              />
            </Field>
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm text-[var(--text)]">
            <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
            Forçar
          </label>
          <div className="mb-3">
            <Button type="submit" disabled={enqueue.isPending || !validRepo || !validPrNumber}>
              {enqueue.isPending ? 'Enfileirando…' : 'Enfileirar'}
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Jobs">
        {jobs.isError ? <p className="text-sm text-[var(--danger)]">Falha ao carregar os jobs.</p> : null}
        {jobs.isLoading ? (
          <p className="text-sm text-[var(--text-muted)]">Carregando…</p>
        ) : jobs.data && jobs.data.jobs.length === 0 ? (
          <EmptyState>Nenhum job ainda. Eles aparecerão quando um review for solicitado à conta configurada.</EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--border)] text-sm">
            {jobs.data?.jobs.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <a
                  className="text-[var(--link)] underline-offset-2 hover:underline"
                  href={job.prUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {job.prTitle}
                </a>
                <span className="flex flex-wrap items-center gap-3 text-[var(--text-muted)]">
                  <span>
                    {job.status} · run {job.runSeq} · {job.attempts} tentativa(s)
                  </span>
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
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
