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
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">review-bot</p>
          <p className="mt-1 text-sm text-slate-400">Painel de reviews automáticas de pull requests</p>
        </div>
        <Card title="Entrar">
          <p className="mb-4 text-sm text-slate-400">Acesso restrito ao painel de reviews.</p>
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
          <p className="mt-4 text-center text-xs text-slate-500">Sessão ociosa expira em 12 h.</p>
        </Card>
      </form>
    </div>
  );
}
