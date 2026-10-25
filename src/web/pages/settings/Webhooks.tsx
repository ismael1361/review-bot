import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

const ALL_EVENTS = ['review.published', 'job.failed', 'job.partial', 'poller.paused'];

type WebhookRow = { id: string; url: string; events: string[]; enabled: boolean };

type Delivery = {
  id: string;
  webhookId: string;
  event: string;
  success: boolean;
  statusCode: number | null;
  attempt: number;
  responseExcerpt: string | null;
  createdAt: number;
};

const DEFAULT_EVENTS = ['review.published', 'job.failed'];

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

function Deliveries({ webhookId }: { webhookId: string }) {
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries', webhookId],
    queryFn: () => api<{ deliveries: Delivery[] }>(`/api/webhooks/${webhookId}/deliveries`),
  });

  if (deliveries.isLoading) {
    return <p className="mt-2 text-xs text-[var(--text-muted)]">Carregando entregas…</p>;
  }
  if (deliveries.isError) {
    return <p className="mt-2 text-xs text-[var(--danger)]">Falha ao carregar as entregas.</p>;
  }

  const rows = deliveries.data?.deliveries ?? [];
  if (rows.length === 0) {
    return <p className="mt-2 text-xs text-[var(--text-muted)]">Nenhuma entrega registrada.</p>;
  }

  return (
    <ul
      aria-label="Últimas entregas"
      className="mt-3 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--sunken)] text-xs"
    >
      {rows.map((delivery) => (
        <li key={delivery.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[var(--text-muted)]">
          <span className="font-medium text-[var(--text)]">{delivery.event}</span>
          <span className={delivery.success ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>{delivery.success ? 'sucesso' : 'falha'}</span>
          <span>status {delivery.statusCode ?? '—'}</span>
          <span>tentativa {delivery.attempt}</span>
          <span className="text-[var(--text-muted)]">{new Date(delivery.createdAt).toLocaleString('pt-BR')}</span>
        </li>
      ))}
    </ul>
  );
}

export function Webhooks() {
  const queryClient = useQueryClient();
  const webhooks = useQuery({ queryKey: ['webhooks'], queryFn: () => api<{ webhooks: WebhookRow[] }>('/api/webhooks') });
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [enabled, setEnabled] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState('');
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [secret, setSecret] = useState('');
  const [testMessage, setTestMessage] = useState('');
  const [testOk, setTestOk] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['webhooks'] });

  function resetEdit() {
    setEditingId(null);
    setUrl('');
    setEvents(DEFAULT_EVENTS);
    setEnabled(true);
    setNewSecret('');
  }

  const create = useMutation({
    mutationFn: () => api<{ secret: string }>('/api/webhooks', { method: 'POST', body: JSON.stringify({ url, events }) }),
    onSuccess: (data) => {
      setSecret(data.secret);
      setUrl('');
      setError('');
      setNotice('');
      refresh();
    },
    onError: (err) => setError(messageFor(err, 'Falha ao criar webhook.')),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api<{ webhook: WebhookRow }>(`/api/webhooks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (data) => {
      if (data?.webhook) {
        queryClient.setQueryData<{ webhooks: WebhookRow[] }>(['webhooks'], (current) => ({
          webhooks: (current?.webhooks ?? []).map((item) => (item.id === data.webhook.id ? data.webhook : item)),
        }));
      }
      setError('');
      setNotice('Webhook atualizado.');
      resetEdit();
      refresh();
    },
    onError: (err) => setError(messageFor(err, 'Falha ao atualizar webhook.')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<{ webhooks: WebhookRow[] }>(['webhooks'], (current) => ({
        webhooks: (current?.webhooks ?? []).filter((item) => item.id !== id),
      }));
      if (editingId === id) {
        resetEdit();
      }
      if (deliveriesFor === id) {
        setDeliveriesFor(null);
      }
      setError('');
      setNotice('Webhook excluído.');
      refresh();
    },
    onError: (err) => setError(messageFor(err, 'Falha ao excluir webhook.')),
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

  function startEdit(webhook: WebhookRow) {
    setEditingId(webhook.id);
    setUrl(webhook.url);
    setEvents([...webhook.events]);
    setEnabled(webhook.enabled);
    setNewSecret('');
    setError('');
    setNotice('');
    setSecret('');
    setTestMessage('');
  }

  function submit() {
    setError('');
    setNotice('');
    if (!editingId) {
      create.mutate();
      return;
    }
    const body: Record<string, unknown> = { url, events, enabled };
    if (newSecret.trim()) {
      body.secret = newSecret;
    }
    update.mutate({ id: editingId, body });
  }

  function confirmRemove(webhook: WebhookRow) {
    if (!window.confirm(`Excluir o webhook "${webhook.url}"?`)) {
      return;
    }
    setError('');
    setNotice('');
    remove.mutate(webhook.id);
  }

  function toggleDeliveries(id: string) {
    setDeliveriesFor((current) => (current === id ? null : id));
  }

  const saving = editingId ? update.isPending : create.isPending;

  return (
    <div className="space-y-4">
      <Card title="Webhooks">
        <ErrorText>{error}</ErrorText>
        {notice ? <p className="mb-3 text-sm text-[var(--success)]">{notice}</p> : null}
        {secret ? (
          <p className="mb-3 rounded-lg border border-[var(--secondary)] bg-[var(--sunken)] px-3 py-2 text-sm text-[var(--secondary)]">
            Secret gerado (exibido uma única vez): <code className="font-mono text-xs">{secret}</code>
          </p>
        ) : null}
        {webhooks.isError ? <p className="mb-2 text-sm text-[var(--danger)]">Falha ao carregar os webhooks.</p> : null}
        <ul className="divide-y divide-[var(--border)] text-sm">
          {webhooks.data?.webhooks.map((webhook) => (
            <li key={webhook.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--text)]">
                  {webhook.url} · <span className="text-[var(--text-muted)]">{webhook.events.join(', ')}</span>
                  {webhook.enabled ? '' : ' · desativado'}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => test.mutate(webhook.id)} disabled={test.isPending}>
                    {test.isPending && test.variables === webhook.id ? 'Testando…' : 'Testar'}
                  </Button>
                  <Button type="button" onClick={() => startEdit(webhook)}>
                    Editar
                  </Button>
                  <Button type="button" onClick={() => toggleDeliveries(webhook.id)}>
                    Entregas
                  </Button>
                  <Button
                    type="button"
                    onClick={() => confirmRemove(webhook)}
                    disabled={remove.isPending}
                    variant="danger"
                  >
                    {remove.isPending && remove.variables === webhook.id ? 'Excluindo…' : 'Excluir'}
                  </Button>
                </span>
              </div>
              {deliveriesFor === webhook.id ? <Deliveries webhookId={webhook.id} /> : null}
            </li>
          ))}
          {webhooks.data && webhooks.data.webhooks.length === 0 ? <li className="py-4 text-[var(--text-muted)]">Nenhum webhook ainda.</li> : null}
        </ul>
        {testMessage ? <p className={`mt-2 text-sm ${testOk ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>{testMessage}</p> : null}
      </Card>
      <Card title={editingId ? 'Editar webhook' : 'Novo webhook'}>
        <Field label="URL">
          <Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://..." />
        </Field>
        <fieldset className="mb-3 text-sm">
          <legend className="mb-1 font-medium text-[var(--text)]">Eventos</legend>
          {ALL_EVENTS.map((event) => (
            <label key={event} className="mr-3 inline-flex items-center gap-1 text-[var(--text-muted)]">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={events.includes(event)}
                onChange={(changeEvent) => setEvents(changeEvent.target.checked ? [...events, event] : events.filter((item) => item !== event))}
              />
              {event}
            </label>
          ))}
        </fieldset>
        {editingId ? (
          <>
            <Field label="Novo secret (opcional)">
              <Input
                type="password"
                autoComplete="new-password"
                value={newSecret}
                placeholder="Deixe em branco para manter o atual"
                onChange={(event) => setNewSecret(event.target.value)}
              />
            </Field>
            <label className="mb-3 flex items-center gap-2 text-sm text-[var(--text)]">
              <input type="checkbox" className="accent-[var(--primary)]" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              Ativo
            </label>
          </>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" onClick={submit} disabled={saving || url.length === 0 || events.length === 0}>
            {saving ? 'Salvando…' : editingId ? 'Salvar webhook' : 'Criar webhook'}
          </Button>
          {editingId ? (
            <Button type="button" onClick={resetEdit} disabled={saving} variant="secondary">
              Cancelar
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
