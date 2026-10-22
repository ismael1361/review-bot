import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type SystemSettingsData = { pollingIntervalSec: number; retentionDays: number; concurrency: number; ignoreDrafts: boolean; skipOwnPrs: boolean };

export function SystemSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['system'], queryFn: () => api<{ settings: SystemSettingsData }>('/api/settings/system') });
  const [form, setForm] = useState<SystemSettingsData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (settings.data && !form) {
      setForm(settings.data.settings);
    }
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: () => api('/api/settings/system', { method: 'PUT', body: JSON.stringify(form) }),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['system'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao salvar.'),
  });

  if (!form) {
    return (
      <Card title="Sistema">
        <p className={`text-sm ${settings.isError ? 'text-red-400' : 'text-slate-500'}`}>
          {settings.isError ? 'Falha ao carregar as configurações.' : 'Carregando…'}
        </p>
      </Card>
    );
  }

  return (
    <Card title="Sistema">
      <ErrorText>{error}</ErrorText>
      <Field label="Intervalo de polling (segundos)">
        <Input
          type="number"
          value={form.pollingIntervalSec}
          onChange={(event) => setForm({ ...form, pollingIntervalSec: Number(event.target.value) })}
        />
      </Field>
      <Field label="Retenção de logs (dias)">
        <Input
          type="number"
          value={form.retentionDays}
          onChange={(event) => setForm({ ...form, retentionDays: Number(event.target.value) })}
        />
      </Field>
      <Field label="Concorrência (1–3)">
        <Input
          type="number"
          value={form.concurrency}
          onChange={(event) => setForm({ ...form, concurrency: Number(event.target.value) })}
        />
      </Field>
      <label className="mb-2 flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          className="accent-sky-400"
          checked={form.ignoreDrafts}
          onChange={(event) => setForm({ ...form, ignoreDrafts: event.target.checked })}
        />
        Ignorar PRs em rascunho
      </label>
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          className="accent-sky-400"
          checked={form.skipOwnPrs}
          onChange={(event) => setForm({ ...form, skipOwnPrs: event.target.checked })}
        />
        Ignorar PRs da própria conta
      </label>
      <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
        Salvar
      </Button>
    </Card>
  );
}
