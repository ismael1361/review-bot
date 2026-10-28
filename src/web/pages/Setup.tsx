import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError } from '../api';
import { Button, Card, ErrorText, Field, Input } from '../components/ui';

type SetupStatus = { needsSetup: boolean; tokenSource?: 'env' | 'generated'; setupToken?: string };

type Step = 'root' | 'github' | 'ai' | 'instance';

type Provider = 'openai_compatible' | 'anthropic';

type AiForm = {
  name: string;
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type InstanceForm = {
  publicUrl: string;
  trustProxy: boolean;
  allowPrivateUrls: boolean;
};

const AI_DEFAULTS = {
  temperature: 0.2,
  maxOutputTokens: 4096,
  maxTurns: 20,
  maxTotalTokens: 200000,
  maxDurationSec: 600,
  maxFindings: 25,
  maxGithubCalls: 80,
  prePrompt: '',
  skillIds: [],
};

const EMPTY_AI_FORM: AiForm = {
  name: '',
  provider: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
};

function initialInstanceForm(): InstanceForm {
  return {
    publicUrl: typeof window === 'undefined' ? '' : window.location.origin,
    trustProxy: false,
    allowPrivateUrls: false,
  };
}

const selectClass =
  'w-full rounded-lg border border-[var(--border-strong)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof ApiRequestError ? error.message : fallback;
}

function aiFailure(error: unknown, action: 'criar' | 'ativar'): string {
  if (error instanceof ApiRequestError && error.message !== 'Erro inesperado') {
    return `Falha ao ${action} o perfil de IA: ${error.message}`;
  }
  return `Falha ao ${action} o perfil de IA.`;
}

export function Setup() {
  const [step, setStep] = useState<Step>('root');
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pat, setPat] = useState('');
  const [aiForm, setAiForm] = useState<AiForm>(EMPTY_AI_FORM);
  const [createdProfileId, setCreatedProfileId] = useState<string | null>(null);
  const [instance, setInstance] = useState<InstanceForm>(initialInstanceForm);
  const [instanceSaved, setInstanceSaved] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => api<SetupStatus>('/api/setup/status') });
  const generatedToken = status.data?.tokenSource === 'generated' ? status.data.setupToken : undefined;
  const tokenValue = generatedToken ?? token;
  const setupComplete = step === 'root' && status.data?.needsSetup === false;

  function goTo(next: Step) {
    setError('');
    setStep(next);
  }

  async function submitRoot(event: FormEvent) {
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
    setBusy(true);
    try {
      await api('/api/setup', { method: 'POST', body: JSON.stringify({ token: tokenValue, username, password }) });
      goTo('github');
    } catch (err) {
      setError(messageFor(err, 'Falha ao concluir o setup.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitGithub(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!pat.trim()) {
      setError('Informe o Personal Access Token.');
      return;
    }
    setBusy(true);
    try {
      await api('/api/settings/github', { method: 'PUT', body: JSON.stringify({ pat }) });
      setPat('');
      goTo('ai');
    } catch (err) {
      setError(messageFor(err, 'Falha ao salvar a credencial do GitHub.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitAi(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!createdProfileId && (!aiForm.name.trim() || !aiForm.baseUrl.trim() || !aiForm.model.trim() || !aiForm.apiKey.trim())) {
      setError('Preencha nome, base URL, modelo e chave de API.');
      return;
    }
    setBusy(true);
    try {
      let profileId = createdProfileId;
      if (!profileId) {
        try {
          const created = await api<{ profile: { id: string } }>('/api/ai-profiles', {
            method: 'POST',
            body: JSON.stringify({
              name: aiForm.name,
              provider: aiForm.provider,
              baseUrl: aiForm.baseUrl,
              model: aiForm.model,
              apiKey: aiForm.apiKey,
              ...AI_DEFAULTS,
            }),
          });
          profileId = created.profile.id;
          setCreatedProfileId(profileId);
        } catch (err) {
          setError(aiFailure(err, 'criar'));
          return;
        }
      }
      try {
        await api(`/api/ai-profiles/${profileId}/activate`, { method: 'POST' });
      } catch (err) {
        setError(aiFailure(err, 'ativar'));
        return;
      }
      setCreatedProfileId(null);
      goTo('instance');
    } finally {
      setBusy(false);
    }
  }

  async function finishSetup() {
    await queryClient.invalidateQueries();
    navigate('/');
  }

  async function submitInstance(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (instanceSaved) {
      await finishSetup();
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ restartRequired: boolean }>('/api/settings/instance', {
        method: 'PUT',
        body: JSON.stringify({
          publicUrl: instance.publicUrl.trim() || undefined,
          trustProxy: instance.trustProxy,
          allowPrivateUrls: instance.allowPrivateUrls,
        }),
      });
      setInstanceSaved(true);
      setRestartRequired(result.restartRequired);
      if (!result.restartRequired) {
        await finishSetup();
      }
    } catch (err) {
      setError(messageFor(err, 'Falha ao salvar as configurações da instância.'));
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    if (generatedToken) {
      await navigator.clipboard?.writeText(generatedToken);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-6 text-[var(--text)] sm:p-8">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-muted)]">review-bot</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">Painel de reviews automáticas de pull requests</p>
        </div>

        {setupComplete ? (
          <Card title="Setup concluído">
            <p className="mb-4 text-sm text-[var(--text-muted)]">
              A configuração inicial já foi concluída. Acesse o painel para continuar.
            </p>
            <Link
              to="/"
              className="flex w-full items-center justify-center rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)]"
            >
              Ir para o painel
            </Link>
          </Card>
        ) : null}

        {step === 'root' && !setupComplete ? (
          <form onSubmit={submitRoot}>
            <Card title="Configuração inicial">
              <ErrorText>{error}</ErrorText>
              <Field label="Token de setup">
                <div className="flex gap-2">
                  <Input
                    value={tokenValue}
                    readOnly={generatedToken !== undefined}
                    onChange={(event) => setToken(event.target.value)}
                    autoFocus={generatedToken === undefined}
                  />
                  {generatedToken ? (
                    <Button type="button" variant="secondary" onClick={() => void copyToken()}>
                      Copiar token
                    </Button>
                  ) : null}
                </div>
              </Field>
              {status.data?.tokenSource === 'env' ? (
                <p className="mb-3 text-xs text-[var(--text-muted)]">Use o token definido em SETUP_TOKEN</p>
              ) : null}
              <Field label="Usuário">
                <Input value={username} onChange={(event) => setUsername(event.target.value)} />
              </Field>
              <Field label="Senha">
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </Field>
              <Field label="Confirmar senha">
                <Input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
              </Field>
              <p className="mb-4 text-xs text-[var(--warning)]">
                Qualquer pessoa com acesso a esta instância antes de concluir o setup pode criar o root. Conclua agora ou
                defina SETUP_TOKEN no .env.
              </p>
              <Button type="submit" className="w-full" disabled={busy}>
                Criar root
              </Button>
            </Card>
          </form>
        ) : null}

        {step === 'github' ? (
          <form onSubmit={submitGithub}>
            <Card title="GitHub">
              <ErrorText>{error}</ErrorText>
              <Field label="Personal Access Token">
                <Input type="password" value={pat} onChange={(event) => setPat(event.target.value)} placeholder="ghp_..." />
              </Field>
              <p className="mb-4 text-xs text-[var(--text-muted)]">
                Fine-grained: Metadata read, Contents read, Pull requests read/write. Classic: escopo repo.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  Salvar e continuar
                </Button>
                <Button type="button" variant="secondary" onClick={() => goTo('ai')} disabled={busy}>
                  Pular por agora
                </Button>
              </div>
            </Card>
          </form>
        ) : null}

        {step === 'ai' ? (
          <form onSubmit={submitAi}>
            <Card title="Perfil de IA">
              <ErrorText>{error}</ErrorText>
              <Field label="Nome">
                <Input value={aiForm.name} onChange={(event) => setAiForm({ ...aiForm, name: event.target.value })} />
              </Field>
              <Field label="Provedor">
                <select
                  className={selectClass}
                  value={aiForm.provider}
                  onChange={(event) => setAiForm({ ...aiForm, provider: event.target.value as Provider })}
                >
                  <option value="openai_compatible">OpenAI-compatible</option>
                  <option value="anthropic">Anthropic</option>
                </select>
              </Field>
              <Field label="Base URL">
                <Input
                  value={aiForm.baseUrl}
                  onChange={(event) => setAiForm({ ...aiForm, baseUrl: event.target.value })}
                />
              </Field>
              <Field label="Modelo">
                <Input value={aiForm.model} onChange={(event) => setAiForm({ ...aiForm, model: event.target.value })} />
              </Field>
              <Field label="Chave de API">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={aiForm.apiKey}
                  onChange={(event) => setAiForm({ ...aiForm, apiKey: event.target.value })}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  Salvar e continuar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setCreatedProfileId(null);
                    goTo('instance');
                  }}
                  disabled={busy}
                >
                  Pular por agora
                </Button>
              </div>
            </Card>
          </form>
        ) : null}

        {step === 'instance' ? (
          <form onSubmit={submitInstance}>
            <Card title="Configurações da instância">
              <ErrorText>{error}</ErrorText>
              <Field label="URL pública">
                <Input
                  value={instance.publicUrl}
                  onChange={(event) => setInstance({ ...instance, publicUrl: event.target.value })}
                  disabled={instanceSaved}
                />
              </Field>
              <label className="mb-2 flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  className="accent-[var(--primary)]"
                  checked={instance.trustProxy}
                  onChange={(event) => setInstance({ ...instance, trustProxy: event.target.checked })}
                  disabled={instanceSaved}
                />
                Confiar no proxy reverso
              </label>
              <label className="mb-3 flex items-center gap-2 text-sm text-[var(--text)]">
                <input
                  type="checkbox"
                  className="accent-[var(--primary)]"
                  checked={instance.allowPrivateUrls}
                  onChange={(event) => setInstance({ ...instance, allowPrivateUrls: event.target.checked })}
                  disabled={instanceSaved}
                />
                Permitir URLs privadas
              </label>
              {restartRequired ? (
                <p className="mb-3 text-sm text-[var(--warning)]">Reinicie o container para aplicar TRUST_PROXY</p>
              ) : null}
              <Button type="submit" className="w-full" disabled={busy}>
                Concluir
              </Button>
            </Card>
          </form>
        ) : null}
      </div>
    </div>
  );
}
