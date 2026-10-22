import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

const ALL_EVENTS = ['review.published', 'job.failed', 'job.partial', 'poller.paused'];
type WebhookRow = { id: string; url: string; events: string[]; enabled: boolean };

export function Webhooks() {
  const queryClient = useQueryClient();
  const webhooks = useQuery({ queryKey: ['webhooks'], queryFn: () => api<{ webhooks: WebhookRow[] }>('/api/webhooks') });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(['review.published', 'job.failed']);
  const [error, setError] = useState('');
  const [secret, setSecret] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testOk, setTestOk] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['webhooks'] });
  const create = useMutation({
    mutationFn: () => api<{ secret: string }>('/api/webhooks', { method: 'POST', body: JSON.stringify({ url, events }) }),
    onSuccess: (data) => {
      setSecret(data.secret);
      setUrl('');
      setError('');
      refresh();
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar webhook.'),
  });
  const test = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/webhooks/${id}/test`, { method: 'POST' }),
    onSuccess: (data) => {
      setTestOk(data.ok);
      setTestMessage(data.ok ? 'Entrega disparada.' : 'Falha na entrega.');
    },
    onError: () => {
      setTestOk(false);
      setTestMessage('Falha ao testar.');
    },
  });

  return (
    <div className="space-y-4">
      <Card title="Webhooks">
        <ErrorText>{error}</ErrorText>
        {secret ? (
          <p className="mb-3 rounded-lg border border-amber-900 bg-amber-950 px-3 py-2 text-sm text-amber-300">
            Secret gerado (exibido uma única vez): <code className="font-mono text-xs">{secret}</code>
          </p>
        ) : null}
        {webhooks.isError ? <p className="mb-2 text-sm text-red-400">Falha ao carregar os webhooks.</p> : null}
        <ul className="divide-y divide-slate-800 text-sm">
          {webhooks.data?.webhooks.map((webhook) => (
            <li key={webhook.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="text-slate-300">
                {webhook.url} · <span className="text-slate-500">{webhook.events.join(', ')}</span>
              </span>
              <Button type="button" onClick={() => test.mutate(webhook.id)}>
                Testar
              </Button>
            </li>
          ))}
          {webhooks.data && webhooks.data.webhooks.length === 0 ? <li className="py-4 text-slate-500">Nenhum webhook ainda.</li> : null}
        </ul>
        {testMessage ? <p className={`mt-2 text-sm ${testOk ? 'text-emerald-400' : 'text-red-400'}`}>{testMessage}</p> : null}
      </Card>
      <Card title="Novo webhook">
        <Field label="URL">
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." />
        </Field>
        <fieldset className="mb-3 text-sm">
          <legend className="mb-1 font-medium text-slate-300">Eventos</legend>
          {ALL_EVENTS.map((event) => (
            <label key={event} className="mr-3 inline-flex items-center gap-1 text-slate-400">
              <input
                type="checkbox"
                className="accent-sky-400"
                checked={events.includes(event)}
                onChange={(changeEvent) => setEvents(changeEvent.target.checked ? [...events, event] : events.filter((item) => item !== event))}
              />
              {event}
            </label>
          ))}
        </fieldset>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending || url.length === 0 || events.length === 0}>
          Criar webhook
        </Button>
      </Card>
    </div>
  );
}
