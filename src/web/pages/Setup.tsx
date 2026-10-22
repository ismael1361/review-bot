import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiRequestError } from '../api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

export function Setup() {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 12) {
      setError('A senha deve ter ao menos 12 caracteres.');
      return;
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.');
      return;
    }
    try {
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ token, username, password }) });
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Falha ao concluir o setup.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">review-bot</p>
          <p className="mt-1 text-sm text-slate-400">Painel de reviews automáticas de pull requests</p>
        </div>
        <Card title="Configuração inicial">
          <p className="mb-4 text-sm text-slate-400">
            Use o token exibido no log do container para criar o usuário root.
          </p>
          <ErrorText>{error}</ErrorText>
          <Field label="Token de setup">
            <Input value={token} onChange={(event) => setToken(event.target.value)} autoFocus />
          </Field>
          <Field label="Usuário root">
            <Input value={username} onChange={(event) => setUsername(event.target.value)} />
          </Field>
          <Field label="Senha">
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Field label="Confirmação da senha">
            <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
          </Field>
          <Button type="submit" className="w-full">
            Criar root
          </Button>
          <p className="mt-4 text-center text-xs text-slate-500">O token aparece uma única vez em: docker compose logs app</p>
        </Card>
      </form>
    </div>
  );
}
