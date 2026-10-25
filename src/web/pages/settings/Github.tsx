import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../../api';
import { Button, Card, ErrorText, Field, Input } from '../../components/ui';

type GithubInfo = { login: string; patLast4: string; scopes: string; validatedAt?: number } | null;

type PermissionState = 'ok' | 'pending' | 'unknown';

type Permission = { label: string; state: PermissionState };

function permissionChecklist(scopes: string): Permission[] {
  const normalized = scopes.trim().toLowerCase();
  if (!normalized) {
    return [
      { label: 'Metadata (leitura)', state: 'unknown' },
      { label: 'Contents (leitura)', state: 'unknown' },
      { label: 'Pull requests (leitura/escrita)', state: 'unknown' },
      { label: 'Acesso a repositórios de organizações', state: 'unknown' },
    ];
  }
  const list = normalized.split(/[,\s]+/).filter(Boolean);
  const hasRepo = list.includes('repo');
  const hasPublicRepo = list.includes('public_repo');
  const hasContents = hasRepo || hasPublicRepo || normalized.includes('contents');
  const hasPullRequests =
    hasRepo || hasPublicRepo || normalized.includes('pull_requests') || normalized.includes('pull-requests');
  return [
    { label: 'Metadata (leitura)', state: hasRepo || hasPublicRepo ? 'ok' : 'unknown' },
    { label: 'Contents (leitura)', state: hasContents ? 'ok' : 'pending' },
    { label: 'Pull requests (leitura/escrita)', state: hasPullRequests ? 'ok' : 'pending' },
    { label: 'Acesso a repositórios de organizações', state: hasRepo || list.includes('read:org') ? 'ok' : 'pending' },
  ];
}

function permissionLabel(state: PermissionState): string {
  if (state === 'ok') {
    return 'OK';
  }
  if (state === 'pending') {
    return 'Pendente';
  }
  return 'Não informado';
}

function permissionClass(state: PermissionState): string {
  if (state === 'ok') {
    return 'text-[var(--success)]';
  }
  if (state === 'pending') {
    return 'text-[var(--warning)]';
  }
  return 'text-[var(--text-muted)]';
}

export function GithubSettings() {
  const queryClient = useQueryClient();
  const [pat, setPat] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const current = useQuery({ queryKey: ['github'], queryFn: () => api<{ credentials: GithubInfo }>('/api/settings/github') });
  const credentials = current.data?.credentials ?? null;
  const permissions = permissionChecklist(credentials?.scopes ?? '');

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
    <div className="space-y-4">
      <Card title="Conta GitHub">
        {current.isLoading ? (
          <p className="mb-3 text-sm text-[var(--text-muted)]">Carregando…</p>
        ) : current.isError ? (
          <p className="mb-3 text-sm text-[var(--danger)]">Falha ao carregar a credencial.</p>
        ) : credentials ? (
          <div className="mb-4 rounded-lg border border-[var(--success)] bg-[var(--sunken)] p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-[var(--text)]">
              <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-[var(--success)]" />
              Conectado como <strong>{credentials.login}</strong>
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Personal Access Token · ••••{credentials.patLast4}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {credentials.validatedAt === undefined
                ? 'Data de validação indisponível.'
                : `Validado em ${new Date(credentials.validatedAt).toLocaleString('pt-BR')}`}
            </p>
          </div>
        ) : (
          <p className="mb-3 text-sm text-[var(--text-muted)]">Nenhuma credencial configurada.</p>
        )}
        <ErrorText>{error}</ErrorText>
        {message ? <p className="mb-3 text-sm text-[var(--success)]">{message}</p> : null}
        <Field label="Personal Access Token">
          <Input type="password" value={pat} onChange={(event) => setPat(event.target.value)} placeholder="ghp_..." />
        </Field>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          Fine-grained: Metadata read, Contents read, Pull requests read/write. Classic: escopo repo.
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

      <Card title="Permissões verificadas">
        {credentials ? (
          <ul className="space-y-1 text-sm">
            {permissions.map((permission) => (
              <li key={permission.label} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[var(--text)]">{permission.label}</span>
                <span className={`text-xs font-semibold ${permissionClass(permission.state)}`}>
                  {permissionLabel(permission.state)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">Configure uma credencial para verificar as permissões.</p>
        )}
      </Card>
    </div>
  );
}
