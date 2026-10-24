import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type Provider = 'openai_compatible' | 'anthropic';

type Profile = {
  id: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  maxTurns: number;
  maxTotalTokens: number;
  maxDurationSec: number;
  maxFindings: number;
  maxGithubCalls: number;
  prePrompt: string;
  isActive: boolean;
  hasApiKey: boolean;
  skillIds: string[];
};

type Skill = { id: string; name: string; description: string; contentMd: string };

type ProfileForm = {
  name: string;
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: string;
  maxOutputTokens: string;
  maxTurns: string;
  maxTotalTokens: string;
  maxDurationSec: string;
  maxFindings: string;
  maxGithubCalls: string;
  prePrompt: string;
  skillIds: string[];
};

const EMPTY_FORM: ProfileForm = {
  name: '',
  provider: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
  temperature: '0.2',
  maxOutputTokens: '4096',
  maxTurns: '20',
  maxTotalTokens: '200000',
  maxDurationSec: '600',
  maxFindings: '25',
  maxGithubCalls: '80',
  prePrompt: '',
  skillIds: [],
};

const selectClass =
  'w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40';
const textareaClass =
  'w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40';
const badgeClass = 'ml-2 rounded-full bg-[var(--sunken)] px-2 py-0.5 text-xs text-[var(--text)]';
const activeBadgeClass = 'ml-2 rounded-full bg-[var(--tertiary)] px-2 py-0.5 text-xs text-[var(--on-tertiary)]';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

function formFromProfile(profile: Profile): ProfileForm {
  return {
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    apiKey: '',
    temperature: String(profile.temperature),
    maxOutputTokens: String(profile.maxOutputTokens),
    maxTurns: String(profile.maxTurns),
    maxTotalTokens: String(profile.maxTotalTokens),
    maxDurationSec: String(profile.maxDurationSec),
    maxFindings: String(profile.maxFindings),
    maxGithubCalls: String(profile.maxGithubCalls),
    prePrompt: profile.prePrompt,
    skillIds: [...profile.skillIds],
  };
}

function numericValues(form: ProfileForm) {
  return {
    temperature: Number(form.temperature),
    maxOutputTokens: Number(form.maxOutputTokens),
    maxTurns: Number(form.maxTurns),
    maxTotalTokens: Number(form.maxTotalTokens),
    maxDurationSec: Number(form.maxDurationSec),
    maxFindings: Number(form.maxFindings),
    maxGithubCalls: Number(form.maxGithubCalls),
  };
}

function ProfileCheckbox({
  skill,
  checked,
  onToggle,
}: {
  skill: Skill;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  return (
    <label className="mr-4 inline-flex items-center gap-2 text-[var(--text)]">
      <input type="checkbox" name="skillIds" className="accent-[var(--primary)]" checked={checked} onChange={(event) => onToggle(event.target.checked)} />
      {skill.name}
    </label>
  );
}

export function Profiles() {
  const queryClient = useQueryClient();
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => api<{ profiles: Profile[] }>('/api/ai-profiles') });
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<{ skills: Skill[] }>('/api/skills') });
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['profiles'] });
  };

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function startEdit(profile: Profile) {
    setEditingId(profile.id);
    setForm(formFromProfile(profile));
    setError('');
    setNotice('');
  }

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: Record<string, unknown> }) =>
      api<{ profile: Profile }>(id ? `/api/ai-profiles/${id}` : '/api/ai-profiles', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data, variables) => {
      if (data?.profile) {
        queryClient.setQueryData<{ profiles: Profile[] }>(['profiles'], (current) => {
          const rows = current?.profiles ?? [];
          return {
            profiles: variables.id ? rows.map((item) => (item.id === data.profile.id ? data.profile : item)) : [...rows, data.profile],
          };
        });
      }
      setNotice(variables.id ? 'Perfil atualizado.' : 'Perfil criado.');
      setError('');
      resetForm();
      refresh();
    },
    onError: (err) => {
      setNotice('');
      setError(messageFor(err, 'Falha ao salvar o perfil.'));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/ai-profiles/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<{ profiles: Profile[] }>(['profiles'], (current) => ({
        profiles: (current?.profiles ?? []).filter((item) => item.id !== id),
      }));
      if (editingId === id) {
        resetForm();
      }
      setError('');
      setNotice('Perfil excluído.');
      refresh();
    },
    onError: (err) => {
      setNotice('');
      setError(messageFor(err, 'Falha ao excluir o perfil.'));
    },
  });

  const testConnection = useMutation({
    mutationFn: (id: string) => api<{ ok: boolean }>(`/api/ai-profiles/${id}/test`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      setError('');
      setNotice('Conexão OK.');
    },
    onError: (err) => {
      setNotice('');
      setError(messageFor(err, 'Falha no teste do provedor.'));
    },
  });

  const activate = useMutation({
    mutationFn: (id: string) => api(`/api/ai-profiles/${id}/activate`, { method: 'POST' }),
    onSuccess: () => {
      setError('');
      setNotice('Perfil ativado.');
      refresh();
    },
    onError: (err) => {
      setNotice('');
      setError(messageFor(err, 'Falha ao ativar o perfil.'));
    },
  });

  function toggleSkill(skillId: string, checked: boolean) {
    setForm((current) => ({
      ...current,
      skillIds: checked
        ? current.skillIds.includes(skillId)
          ? current.skillIds
          : [...current.skillIds, skillId]
        : current.skillIds.filter((item) => item !== skillId),
    }));
  }

  function moveSkill(index: number, delta: number) {
    setForm((current) => {
      const target = index + delta;
      const first = current.skillIds[index];
      const second = current.skillIds[target];
      if (first === undefined || second === undefined) {
        return current;
      }
      const skillIds = [...current.skillIds];
      skillIds[index] = second;
      skillIds[target] = first;
      return { ...current, skillIds };
    });
  }

  function submit() {
    setError('');
    setNotice('');
    if (!form.name.trim() || !form.baseUrl.trim() || !form.model.trim()) {
      setError('Preencha nome, base URL e modelo.');
      return;
    }
    if (!editingId && !form.apiKey.trim()) {
      setError('Chave de API é obrigatória para criar um perfil.');
      return;
    }
    const numbers = numericValues(form);
    const numericKeys = Object.keys(numbers) as Array<keyof typeof numbers>;
    if (numericKeys.some((key) => !Number.isFinite(numbers[key])) || !form.temperature.trim()) {
      setError('Preencha os limites numéricos.');
      return;
    }
    const body: Record<string, unknown> = {
      name: form.name,
      provider: form.provider,
      baseUrl: form.baseUrl,
      model: form.model,
      temperature: numbers.temperature,
      maxOutputTokens: numbers.maxOutputTokens,
      maxTurns: numbers.maxTurns,
      maxTotalTokens: numbers.maxTotalTokens,
      maxDurationSec: numbers.maxDurationSec,
      maxFindings: numbers.maxFindings,
      maxGithubCalls: numbers.maxGithubCalls,
      prePrompt: form.prePrompt,
      skillIds: form.skillIds,
    };
    if (form.apiKey.trim()) {
      body.apiKey = form.apiKey;
    }
    save.mutate({ id: editingId, body });
  }

  function confirmRemove(profile: Profile) {
    if (!window.confirm(`Excluir o perfil "${profile.name}"?`)) {
      return;
    }
    setError('');
    setNotice('');
    remove.mutate(profile.id);
  }

  return (
    <div className="space-y-4">
      <Card title="Perfis de IA">
        {profiles.isError ? <p className="mb-2 text-sm text-[var(--link)]">Falha ao carregar os perfis.</p> : null}
        {profiles.isLoading ? <p className="py-4 text-sm text-[var(--text-muted)]">Carregando perfis…</p> : null}
        <ul className="divide-y divide-[var(--border)] text-sm">
          {profiles.data?.profiles.map((profile) => (
            <li key={profile.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="text-[var(--text)]">
                <span className="font-medium">{profile.name}</span>
                <span className="text-[var(--text-muted)]">
                  {' '}
                  · {profile.provider} · {profile.model}
                </span>
                {profile.isActive ? <span className={activeBadgeClass}>ativo</span> : null}
                {profile.hasApiKey ? <span className={badgeClass}>chave salva</span> : <span className={badgeClass}>sem chave</span>}
              </span>
              <span className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => testConnection.mutate(profile.id)} disabled={testConnection.isPending}>
                  {testConnection.isPending && testConnection.variables === profile.id ? 'Testando…' : 'Testar'}
                </Button>
                <Button type="button" onClick={() => startEdit(profile)}>
                  Editar
                </Button>
                {profile.isActive ? null : (
                  <Button type="button" onClick={() => activate.mutate(profile.id)} disabled={activate.isPending}>
                    {activate.isPending && activate.variables === profile.id ? 'Ativando…' : 'Ativar'}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={() => confirmRemove(profile)}
                  disabled={profile.isActive || remove.isPending}
                  title={profile.isActive ? 'Desative ou ative outro perfil antes de excluir.' : undefined}
                >
                  {remove.isPending && remove.variables === profile.id ? 'Excluindo…' : 'Excluir'}
                </Button>
              </span>
            </li>
          ))}
          {profiles.data && profiles.data.profiles.length === 0 ? <li className="py-4 text-[var(--text-muted)]">Nenhum perfil ainda.</li> : null}
        </ul>
      </Card>
      <Card title={editingId ? 'Editar perfil' : 'Novo perfil'}>
        <ErrorText>{error}</ErrorText>
        {notice ? <p className="mb-3 text-sm text-[var(--tertiary-hover)]">{notice}</p> : null}
        <Field label="Nome">
          <Input name="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Provedor">
          <select
            name="provider"
            className={selectClass}
            value={form.provider}
            onChange={(event) => setForm({ ...form, provider: event.target.value as Provider })}
          >
            <option value="openai_compatible">OpenAI-compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </Field>
        <Field label="Base URL">
          <Input name="baseUrl" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
        </Field>
        <Field label="Modelo">
          <Input name="model" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
        </Field>
        <Field label="Chave de API">
          <Input
            name="apiKey"
            type="password"
            autoComplete="new-password"
            value={form.apiKey}
            placeholder={editingId ? 'Deixe em branco para manter a chave atual' : 'Obrigatória'}
            onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
          />
        </Field>
        {editingId && profiles.data?.profiles.find((item) => item.id === editingId)?.hasApiKey ? (
          <p className="mb-3 text-xs text-[var(--text-muted)]">A chave atual está salva e não é exibida. Preencha apenas para substituí-la.</p>
        ) : null}
        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Temperatura">
            <Input
              name="temperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={form.temperature}
              onChange={(event) => setForm({ ...form, temperature: event.target.value })}
            />
          </Field>
          <Field label="Máx. tokens de saída">
            <Input
              name="maxOutputTokens"
              type="number"
              min="1"
              max="32000"
              value={form.maxOutputTokens}
              onChange={(event) => setForm({ ...form, maxOutputTokens: event.target.value })}
            />
          </Field>
          <Field label="Máx. turnos">
            <Input
              name="maxTurns"
              type="number"
              min="1"
              max="50"
              value={form.maxTurns}
              onChange={(event) => setForm({ ...form, maxTurns: event.target.value })}
            />
          </Field>
          <Field label="Máx. tokens totais">
            <Input
              name="maxTotalTokens"
              type="number"
              min="1000"
              max="1000000"
              value={form.maxTotalTokens}
              onChange={(event) => setForm({ ...form, maxTotalTokens: event.target.value })}
            />
          </Field>
          <Field label="Duração máxima (s)">
            <Input
              name="maxDurationSec"
              type="number"
              min="60"
              max="3600"
              value={form.maxDurationSec}
              onChange={(event) => setForm({ ...form, maxDurationSec: event.target.value })}
            />
          </Field>
          <Field label="Máx. achados">
            <Input
              name="maxFindings"
              type="number"
              min="1"
              max="50"
              value={form.maxFindings}
              onChange={(event) => setForm({ ...form, maxFindings: event.target.value })}
            />
          </Field>
          <Field label="Máx. chamadas GitHub">
            <Input
              name="maxGithubCalls"
              type="number"
              min="1"
              max="500"
              value={form.maxGithubCalls}
              onChange={(event) => setForm({ ...form, maxGithubCalls: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Pré-prompt">
          <textarea
            name="prePrompt"
            className={`h-28 ${textareaClass}`}
            value={form.prePrompt}
            onChange={(event) => setForm({ ...form, prePrompt: event.target.value })}
          />
        </Field>
        <fieldset className="mb-3 text-sm">
          <legend className="mb-2 block font-medium text-[var(--text)]">Skills</legend>
          {skills.isLoading ? <p className="text-[var(--text-muted)]">Carregando skills…</p> : null}
          {skills.isError ? <p className="text-[var(--link)]">Falha ao carregar as skills.</p> : null}
          <div className="flex flex-wrap gap-y-1">
            {skills.data?.skills.map((skill) => (
              <ProfileCheckbox
                key={skill.id}
                skill={skill}
                checked={form.skillIds.includes(skill.id)}
                onToggle={(checked) => toggleSkill(skill.id, checked)}
              />
            ))}
          </div>
          {skills.data && skills.data.skills.length === 0 ? <p className="text-[var(--text-muted)]">Nenhuma skill cadastrada.</p> : null}
          {form.skillIds.length > 0 ? (
            <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--sunken)] p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Ordem das skills</p>
              <ol className="space-y-1">
                {form.skillIds.map((skillId, index) => {
                  const name = skills.data?.skills.find((item) => item.id === skillId)?.name ?? skillId;
                  return (
                    <li key={skillId} className="flex items-center justify-between gap-2">
                      <span className="text-[var(--text)]">
                        {index + 1}. {name}
                      </span>
                      <span className="flex gap-1">
                        <button
                          type="button"
                          aria-label={`Mover ${name} para cima`}
                          disabled={index === 0}
                          onClick={() => moveSkill(index, -1)}
                          className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-xs text-[var(--text)] transition hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Mover ${name} para baixo`}
                          disabled={index === form.skillIds.length - 1}
                          onClick={() => moveSkill(index, 1)}
                          className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-xs text-[var(--text)] transition hover:border-[var(--border-strong)] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          ↓
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}
        </fieldset>
        <div className="flex gap-2">
          <Button type="button" onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : editingId ? 'Salvar perfil' : 'Criar perfil'}
          </Button>
          {editingId ? (
            <Button type="button" onClick={resetForm} disabled={save.isPending} variant="secondary">
              Cancelar
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
