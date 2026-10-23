import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type Skill = { id: string; name: string; description: string; contentMd: string };

type SkillForm = { name: string; description: string; contentMd: string };

const EMPTY_FORM: SkillForm = { name: '', description: '', contentMd: '' };

const textareaClass =
  'h-32 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/40';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

export function Skills() {
  const queryClient = useQueryClient();
  const skills = useQuery({ queryKey: ['skills'], queryFn: () => api<{ skills: Skill[] }>('/api/skills') });
  const [form, setForm] = useState<SkillForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['skills'] });
  };

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function startEdit(skill: Skill) {
    setEditingId(skill.id);
    setForm({ name: skill.name, description: skill.description, contentMd: skill.contentMd });
    setError('');
    setNotice('');
  }

  const save = useMutation({
    mutationFn: ({ id, body }: { id: string | null; body: SkillForm }) =>
      api<{ skill: Skill }>(id ? `/api/skills/${id}` : '/api/skills', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data, variables) => {
      if (data?.skill) {
        queryClient.setQueryData<{ skills: Skill[] }>(['skills'], (current) => {
          const rows = current?.skills ?? [];
          return {
            skills: variables.id ? rows.map((item) => (item.id === data.skill.id ? data.skill : item)) : [...rows, data.skill],
          };
        });
      }
      setNotice(variables.id ? 'Skill atualizada.' : 'Skill criada.');
      setError('');
      resetForm();
      refresh();
    },
    onError: (err) => {
      setNotice('');
      setError(messageFor(err, 'Falha ao salvar a skill.'));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/skills/${id}`, { method: 'DELETE' }),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<{ skills: Skill[] }>(['skills'], (current) => ({
        skills: (current?.skills ?? []).filter((item) => item.id !== id),
      }));
      if (editingId === id) {
        resetForm();
      }
      setError('');
      setNotice('Skill excluída.');
      refresh();
    },
    onError: (err) => {
      setNotice('');
      setError(messageFor(err, 'Falha ao excluir a skill.'));
    },
  });

  function submit() {
    setError('');
    setNotice('');
    if (!form.name.trim() || !form.contentMd.trim()) {
      setError('Preencha nome e conteúdo da skill.');
      return;
    }
    save.mutate({ id: editingId, body: form });
  }

  function confirmRemove(skill: Skill) {
    if (!window.confirm(`Excluir a skill "${skill.name}"?`)) {
      return;
    }
    setError('');
    setNotice('');
    remove.mutate(skill.id);
  }

  return (
    <div className="space-y-4">
      <Card title="Skills">
        {notice ? <p className="mb-3 text-sm text-emerald-400">{notice}</p> : null}
        {skills.isError ? <p className="mb-2 text-sm text-red-400">Falha ao carregar as skills.</p> : null}
        {skills.isLoading ? <p className="py-4 text-sm text-slate-500">Carregando skills…</p> : null}
        <ul className="divide-y divide-slate-800 text-sm">
          {skills.data?.skills.map((skill) => (
            <li key={skill.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-slate-300">
                  <span className="font-medium">{skill.name}</span>
                  <span className="text-slate-500"> · {skill.description || 'sem descrição'}</span>
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">{skill.contentMd}</p>
              </div>
              <span className="flex gap-2">
                <Button type="button" onClick={() => startEdit(skill)}>
                  Editar
                </Button>
                <Button
                  type="button"
                  onClick={() => confirmRemove(skill)}
                  disabled={remove.isPending}
                  className="bg-red-950 text-red-200 hover:bg-red-900"
                >
                  {remove.isPending && remove.variables === skill.id ? 'Excluindo…' : 'Excluir'}
                </Button>
              </span>
            </li>
          ))}
          {skills.data && skills.data.skills.length === 0 ? <li className="py-4 text-slate-500">Nenhuma skill ainda.</li> : null}
        </ul>
      </Card>
      <Card title={editingId ? 'Editar skill' : 'Nova skill'}>
        <ErrorText>{error}</ErrorText>
        <Field label="Nome">
          <Input name="skillName" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Descrição">
          <Input name="skillDescription" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
        <Field label="Conteúdo (Markdown)">
          <textarea
            name="skillContent"
            className={textareaClass}
            value={form.contentMd}
            onChange={(event) => setForm({ ...form, contentMd: event.target.value })}
          />
        </Field>
        <div className="flex gap-2">
          <Button type="button" onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : editingId ? 'Salvar skill' : 'Criar skill'}
          </Button>
          {editingId ? (
            <Button type="button" onClick={resetForm} disabled={save.isPending} className="bg-slate-700 text-slate-100 hover:bg-slate-600">
              Cancelar
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
