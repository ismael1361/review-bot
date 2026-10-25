import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      await queryClient.invalidateQueries();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Falha ao entrar.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--text)] sm:p-8">
      <form onSubmit={submit} className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">review-bot</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Painel de reviews automáticas de pull requests</p>
        </div>
        <Card title="Entrar">
          <p className="mb-4 text-sm text-[var(--text-muted)]">Acesso restrito ao painel de reviews.</p>
          <ErrorText>{error}</ErrorText>
          <Field label="Usuário">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
          </Field>
          <Field label="Senha">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Button type="submit" className="w-full">
            Entrar
          </Button>
          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">Sessão ociosa expira em 12 h.</p>
        </Card>
      </form>
    </div>
  );
}
