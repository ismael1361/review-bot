import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type Skill = { id: string; name: string; description: string; contentMd: string };

export function Skills() {
  const queryClient = useQueryClient();
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<{ skills: Skill[] }>('/api/skills') });
  const [form, setForm] = useState({ name: '', description: '', contentMd: '' });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: () => api('/api/skills', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      setForm({ name: '', description: '', contentMd: '' });
      setError('');
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar skill.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/skills/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  return (
    <div className="space-y-4">
      <Card title="Skills">
        {skills.isError ? <p className="mb-2 text-sm text-red-400">Falha ao carregar as skills.</p> : null}
        <ul className="divide-y divide-slate-800 text-sm">
          {skills.data?.skills.map((skill) => (
            <li key={skill.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="text-slate-300">
                {skill.name} · <span className="text-slate-500">{skill.description || 'sem descrição'}</span>
              </span>
              <Button type="button" onClick={() => remove.mutate(skill.id)}>
                Remover
              </Button>
            </li>
          ))}
          {skills.data && skills.data.skills.length === 0 ? <li className="py-4 text-slate-500">Nenhuma skill ainda.</li> : null}
        </ul>
      </Card>
      <Card title="Nova skill">
        <ErrorText>{error}</ErrorText>
        <Field label="Nome">
          <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Descrição">
          <Input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <Field label="Conteúdo (Markdown)">
          <textarea
            className="h-32 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            value={form.contentMd}
            onChange={(event) => setForm({ ...form, contentMd: event.target.value })}
          />
        </Field>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>
          Criar skill
        </Button>
      </Card>
    </div>
  );
}
