import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type Profile = { id: string; name: string; provider: string; model: string; isActive: boolean; hasApiKey: boolean };

export function Profiles() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => api<{ profiles: Profile[] }>('/api/ai-profiles') });
  const [form, setForm] = useState({ name: '', provider: 'openai_compatible', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' });
  const [error, setError] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['profiles'] });
  const create = useMutation({
    mutationFn: () => api('/api/ai-profiles', { method: 'POST', body: JSON.stringify({ ...form, skillIds: [] }) }),
    onSuccess: () => {
      setForm({ ...form, name: '', model: '', apiKey: '' });
      setError('');
      refresh();
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar perfil.'),
  });
  const activate = useMutation({ mutationFn: (id: string) => api(`/api/ai-profiles/${id}/activate`, { method: 'POST' }), onSuccess: refresh });
  const test = useMutation({ mutationFn: (id: string) => api(`/api/ai-profiles/${id}/test`, { method: 'POST', body: '{}' }) });

  return (
    <div className="space-y-4">
      <Card title="Perfis de IA">
        {profiles.isError ? <p className="mb-2 text-sm text-red-400">Falha ao carregar os perfis.</p> : null}
        <ul className="divide-y divide-slate-800 text-sm">
          {profiles.data?.profiles.map((profile) => (
            <li key={profile.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="text-slate-300">
                {profile.name} · {profile.provider} · {profile.model}
                {profile.isActive ? (
                  <span className="ml-2 rounded-full bg-emerald-950 px-2 py-0.5 text-xs text-emerald-300">ativo</span>
                ) : null}
              </span>
              <span className="flex gap-2">
                <Button type="button" onClick={() => test.mutate(profile.id)}>
                  Testar
                </Button>
                {profile.isActive ? null : (
                  <Button type="button" onClick={() => activate.mutate(profile.id)}>
                    Ativar
                  </Button>
                )}
              </span>
            </li>
          ))}
          {profiles.data && profiles.data.profiles.length === 0 ? <li className="py-4 text-slate-500">Nenhum perfil ainda.</li> : null}
        </ul>
        {test.isError ? <p className="mt-2 text-sm text-red-400">Falha no teste do provedor.</p> : null}
      </Card>
      <Card title="Novo perfil">
        <ErrorText>{error}</ErrorText>
        <Field label="Nome">
          <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Provedor">
          <select
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            value={form.provider}
            onChange={(event) => setForm({ ...form, provider: event.target.value })}
          >
            <option value="openai_compatible">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </Field>
        <Field label="Base URL">
          <Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
        </Field>
        <Field label="Modelo">
          <Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
        </Field>
        <Field label="Chave de API">
          <Input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
        </Field>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>
          Criar perfil
        </Button>
      </Card>
    </div>
  );
}
