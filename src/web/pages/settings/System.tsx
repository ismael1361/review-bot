import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type SystemSettingsData = { pollingIntervalSec: number; retentionDays: number; concurrency: number; ignoreDrafts: boolean; skipOwnPrs: boolean };

type InstanceSettingsData = { publicUrl?: string; trustProxy: boolean; allowPrivateUrls: boolean };

type InstanceForm = { publicUrl: string; trustProxy: boolean; allowPrivateUrls: boolean };

type InstanceResponse = { settings: InstanceSettingsData; restartRequired: boolean };

export function SystemSettings() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['system'], queryFn: () => api<{ settings: SystemSettingsData }>('/api/settings/system') });
  const [form, setForm] = useState<SystemSettingsData | null>(null);
  const [error, setError] = useState('');
  const instance = useQuery({ queryKey: ['instance'], queryFn: () => api<InstanceResponse>('/api/settings/instance') });
  const [instanceForm, setInstanceForm] = useState<InstanceForm | null>(null);
  const [instanceError, setInstanceError] = useState('');
  const [instanceNotice, setInstanceNotice] = useState('');
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    if (settings.data && !form) {
      setForm(settings.data.settings);
    }
  }, [settings.data, form]);

  useEffect(() => {
    if (instance.data && !instanceForm) {
      setInstanceForm({
        publicUrl: instance.data.settings.publicUrl ?? '',
        trustProxy: instance.data.settings.trustProxy,
        allowPrivateUrls: instance.data.settings.allowPrivateUrls,
      });
    }
  }, [instance.data, instanceForm]);

  useEffect(() => {
    if (instance.data) {
      setRestartRequired(instance.data.restartRequired);
    }
  }, [instance.data]);

  const save = useMutation({
    mutationFn: () => api('/api/settings/system', { method: 'PUT', body: JSON.stringify(form) }),
    onSuccess: () => {
      setError('');
      queryClient.invalidateQueries({ queryKey: ['system'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao salvar.'),
  });

  const saveInstance = useMutation({
    mutationFn: () =>
      api<InstanceResponse>('/api/settings/instance', {
        method: 'PUT',
        body: JSON.stringify({
          publicUrl: instanceForm?.publicUrl.trim() || undefined,
          trustProxy: instanceForm?.trustProxy,
          allowPrivateUrls: instanceForm?.allowPrivateUrls,
        }),
      }),
    onSuccess: (data) => {
      setInstanceError('');
      setRestartRequired(data.restartRequired);
      setInstanceNotice(data.restartRequired ? '' : 'Configurações salvas.');
      queryClient.invalidateQueries({ queryKey: ['instance'] });
    },
    onError: (err) => {
      setInstanceNotice('');
      setInstanceError(err instanceof ApiRequestError ? err.message : 'Falha ao salvar.');
    },
  });

  return (
    <div className="space-y-4">
      <Card title="Sistema">
        {form ? (
          <>
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
            <label className="mb-2 flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={form.ignoreDrafts}
                onChange={(event) => setForm({ ...form, ignoreDrafts: event.target.checked })}
              />
              Ignorar PRs em rascunho
            </label>
            <label className="mb-3 flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={form.skipOwnPrs}
                onChange={(event) => setForm({ ...form, skipOwnPrs: event.target.checked })}
              />
              Ignorar PRs da própria conta
            </label>
            <Button type="button" onClick={() => save.mutate()} disabled={save.isPending}>
              Salvar
            </Button>
          </>
        ) : (
          <p className={`text-sm ${settings.isError ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
            {settings.isError ? 'Falha ao carregar as configurações.' : 'Carregando…'}
          </p>
        )}
      </Card>

      <Card title="Instância">
        <ErrorText>{instanceError}</ErrorText>
        {instanceNotice ? <p className="mb-3 text-sm text-[var(--success)]">{instanceNotice}</p> : null}
        {restartRequired ? (
          <p className="mb-3 text-sm text-[var(--warning)]">Reinicie o container para aplicar TRUST_PROXY</p>
        ) : null}
        {instanceForm ? (
          <>
            <Field label="URL pública">
              <Input
                value={instanceForm.publicUrl}
                placeholder="https://reviews.exemplo.com"
                onChange={(event) => setInstanceForm({ ...instanceForm, publicUrl: event.target.value })}
              />
            </Field>
            <label className="mb-2 flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={instanceForm.trustProxy}
                onChange={(event) => setInstanceForm({ ...instanceForm, trustProxy: event.target.checked })}
              />
              Confiar no proxy reverso
            </label>
            <label className="mb-3 flex items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                className="accent-[var(--primary)]"
                checked={instanceForm.allowPrivateUrls}
                onChange={(event) => setInstanceForm({ ...instanceForm, allowPrivateUrls: event.target.checked })}
              />
              Permitir URLs privadas
            </label>
            <Button type="button" onClick={() => saveInstance.mutate()} disabled={saveInstance.isPending}>
              Salvar instância
            </Button>
          </>
        ) : (
          <p className={`text-sm ${instance.isError ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>
            {instance.isError ? 'Falha ao carregar as configurações da instância.' : 'Carregando…'}
          </p>
        )}
      </Card>
    </div>
  );
}
