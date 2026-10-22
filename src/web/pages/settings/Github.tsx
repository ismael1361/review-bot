import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type GithubInfo = { login: string; patLast4: string; scopes: string } | null;

export function GithubSettings() {
  const queryClient = useQueryClient();
  const [pat, setPat] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const current = useQuery({ queryKey: ['github'], queryFn: () => api<{ credentials: GithubInfo }>('/api/settings/github') });

  const save = useMutation({
    mutationFn: () => api('/api/settings/github', { method: 'PUT', body: JSON.stringify({ pat }) }),
    onSuccess: () => {
      setMessage('Credencial salva.');
      setPat('');
      queryClient.invalidateQueries({ queryKey: ['github'] });
    },
    onError: (err) => setError(err instanceof ApiRequestError ? err.message : 'Falha ao salvar.'),
  });

  return (
    <Card title="Conta GitHub">
      {current.isError ? (
        <p className="mb-3 text-sm text-red-400">Falha ao carregar a credencial.</p>
      ) : (
        <p className="mb-3 text-sm text-slate-400">
          {current.data?.credentials
            ? `Conectado como ${current.data.credentials.login} (token ••••${current.data.credentials.patLast4})`
            : 'Nenhuma credencial configurada.'}
        </p>
      )}
      <ErrorText>{error}</ErrorText>
      {message ? <p className="mb-3 text-sm text-emerald-400">{message}</p> : null}
      <Field label="Personal Access Token">
        <Input type="password" value={pat} onChange={(event) => setPat(event.target.value)} placeholder="ghp_..." />
      </Field>
      <p className="mb-3 text-xs text-slate-500">
        Fine-grained: Metadata read, Contents read, Pull requests read/write.
      </p>
      <Button
        type="button"
        onClick={() => {
          setError('');
          setMessage('');
          save.mutate();
        }}
        disabled={save.isPending || pat.length < 20}
      >
        Salvar e testar
      </Button>
    </Card>
  );
}
