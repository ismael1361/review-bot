import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type UserRow = { id: string; username: string; role: 'admin' | 'operator' | 'viewer'; isRoot: boolean; disabled: boolean };

export function Users() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: UserRow[] }>('/api/users') });
  const [form, setForm] = useState({ username: '', password: '', role: 'viewer' });
  const [error, setError] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });
  const create = useMutation({
    mutationFn: () => api('/api/users', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      setForm({ username: '', password: '', role: 'viewer' });
      setError('');
      refresh();
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao criar usuário.'),
  });
  const patch = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      api(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify({ disabled }) }),
    onSuccess: refresh,
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao alterar usuário.'),
  });

  return (
    <div className="space-y-4">
      <Card title="Usuários">
        <ErrorText>{error}</ErrorText>
        {users.isError ? <p className="mb-2 text-sm text-red-400">Falha ao carregar os usuários.</p> : null}
        <ul className="divide-y divide-slate-800 text-sm">
          {users.data?.users.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="text-slate-300">
                {user.username} · {user.role}
                {user.isRoot ? ' · root' : ''}
                {user.disabled ? ' · desativado' : ''}
              </span>
              {user.isRoot ? null : (
                <Button type="button" onClick={() => patch.mutate({ id: user.id, disabled: !user.disabled })}>
                  {user.disabled ? 'Ativar' : 'Desativar'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Novo usuário">
        <Field label="Usuário">
          <Input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
        </Field>
        <Field label="Senha">
          <Input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        </Field>
        <Field label="Papel">
          <select
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/40"
            value={form.role}
            onChange={(event) => setForm({ ...form, role: event.target.value })}
          >
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Button type="button" onClick={() => create.mutate()} disabled={create.isPending}>
          Criar usuário
        </Button>
      </Card>
    </div>
  );
}
