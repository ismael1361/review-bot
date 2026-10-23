import { useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiRequestError } from '../api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

export function Password() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (newPassword.length < 12) {
      setError('A nova senha deve ter ao menos 12 caracteres.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('As senhas não coincidem.');
      return;
    }
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setNotice('Senha alterada.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Falha ao alterar a senha.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-100">Senha</h1>
        <p className="mt-1 text-sm text-slate-400">Altere a senha da sua conta</p>
      </div>
      <form onSubmit={submit} className="max-w-xl">
        <Card title="Alterar senha">
          <ErrorText>{error}</ErrorText>
          {notice ? <p className="mb-3 text-sm text-emerald-400">{notice}</p> : null}
          <Field label="Senha atual">
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </Field>
          <Field label="Nova senha">
            <Input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </Field>
          <Field label="Confirmação da nova senha">
            <Input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </Field>
          <Button type="submit">Alterar senha</Button>
        </Card>
      </form>
    </div>
  );
}
