import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type Role = 'admin' | 'operator' | 'viewer';
type UserRow = { id: string; username: string; role: Role; isRoot: boolean; disabled: boolean };

const selectClass =
  'w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40';
const rowSelectClass =
  'rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

export function Users() {
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: UserRow[] }>('/api/users') });
  const [form, setForm] = useState<{ username: string; password: string; role: Role }>({ username: '', password: '', role: 'viewer' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: () => api('/api/users', { method: 'POST', body: JSON.stringify(form) }),
    onSuccess: () => {
      setForm({ username: '', password: '', role: 'viewer' });
      setError('');
      setNotice('');
      refresh();
    },
    onError: (err) => setError(messageFor(err, 'Falha ao criar usuário.')),
  });

  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: Role; disabled?: boolean }) =>
      api<{ user: UserRow }>(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (data) => {
      if (data?.user) {
        queryClient.setQueryData<{ users: UserRow[] }>(['users'], (current) => ({
          users: (current?.users ?? []).map((user) => (user.id === data.user.id ? data.user : user)),
        }));
      }
      setError('');
      refresh();
    },
    onError: (err) => setError(messageFor(err, 'Falha ao alterar usuário.')),
  });

  const reset = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
    onSuccess: () => {
      setResetFor(null);
      setNewPassword('');
      setError('');
      setNotice('Senha redefinida.');
    },
    onError: (err) => setError(messageFor(err, 'Falha ao redefinir a senha.')),
  });

  function startReset(user: UserRow) {
    setResetFor(user.id);
    setNewPassword('');
    setError('');
    setNotice('');
  }

  function cancelReset() {
    setResetFor(null);
    setNewPassword('');
  }

  function submitReset(id: string) {
    setError('');
    setNotice('');
    if (newPassword.length < 12) {
      setError('A nova senha deve ter ao menos 12 caracteres.');
      return;
    }
    reset.mutate({ id, password: newPassword });
  }

  return (
    <div className="space-y-4">
      <Card title="Usuários">
        <ErrorText>{error}</ErrorText>
        {notice ? <p className="mb-3 text-sm text-[var(--tertiary-hover)]">{notice}</p> : null}
        {users.isError ? <p className="mb-2 text-sm text-[var(--link)]">Falha ao carregar os usuários.</p> : null}
        <ul className="divide-y divide-[var(--border)] text-sm">
          {users.data?.users.map((user) => (
            <li key={user.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--text)]">
                  {user.username} · {user.role}
                  {user.isRoot ? ' · root' : ''}
                  {user.disabled ? ' · desativado' : ''}
                </span>
                {user.isRoot ? null : (
                  <span className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Papel de ${user.username}`}
                      className={rowSelectClass}
                      value={user.role}
                      onChange={(event) => patch.mutate({ id: user.id, role: event.target.value as Role })}
                      disabled={patch.isPending}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="operator">Operator</option>
                      <option value="admin">Admin</option>
                    </select>
                    <Button type="button" onClick={() => patch.mutate({ id: user.id, disabled: !user.disabled })} disabled={patch.isPending}>
                      {user.disabled ? 'Ativar' : 'Desativar'}
                    </Button>
                    <Button type="button" onClick={() => startReset(user)}>
                      Redefinir senha de {user.username}
                    </Button>
                  </span>
                )}
              </div>
              {resetFor === user.id ? (
                <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--sunken)] p-3">
                  <Field label={`Nova senha de ${user.username}`}>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="button" onClick={() => submitReset(user.id)} disabled={reset.isPending}>
                      {reset.isPending ? 'Salvando…' : 'Salvar nova senha'}
                    </Button>
                    <Button
                      type="button"
                      onClick={cancelReset}
                      disabled={reset.isPending}
                      variant="secondary"
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : null}
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
          <select className={selectClass} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
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
