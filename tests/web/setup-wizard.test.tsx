// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Setup } from '../../src/web/pages/Setup';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Setup />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Setup wizard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('percorre root, GitHub, IA e configurações da instância', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/setup/status') return json({ needsSetup: true, tokenSource: 'generated', setupToken: 'setup-token-123456' });
      if (url === '/api/setup') return json({ userId: 'u1' }, 201);
      if (url === '/api/settings/github') return json({ credentials: { login: 'bot', patLast4: 'abcd', scopes: 'repo' } });
      if (url === '/api/ai-profiles') return json({ profile: { id: 'p1' } }, 201);
      if (url === '/api/settings/instance') return json({ settings: { publicUrl: 'http://localhost:7080', trustProxy: false, allowPrivateUrls: false }, restartRequired: false });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWizard();
    await screen.findByDisplayValue('setup-token-123456');
    await userEvent.type(screen.getByLabelText('Usuário'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-segura');
    await userEvent.type(screen.getByLabelText('Confirmar senha'), 'senha-muito-segura');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    await screen.findByRole('heading', { name: /GitHub/i });
    await userEvent.type(screen.getByLabelText('Personal Access Token'), 'ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
    await screen.findByRole('heading', { name: /Perfil de IA/i });
    await userEvent.click(screen.getByRole('button', { name: 'Pular por agora' }));
    await screen.findByRole('heading', { name: /Configurações da instância/i });
    await userEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/github', expect.objectContaining({ method: 'PUT' }));
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/instance', expect.objectContaining({ method: 'PUT' }));
    const instancePut = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/settings/instance' && init?.method === 'PUT',
    );
    expect(JSON.parse(String(instancePut?.[1]?.body)).publicUrl).toBe(window.location.origin);
  });

  it('cria o perfil de IA com os defaults e ativa o perfil', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/setup/status') return json({ needsSetup: true, tokenSource: 'env' });
      if (url === '/api/setup' && method === 'POST') return json({ userId: 'u1' }, 201);
      if (url === '/api/ai-profiles' && method === 'POST') return json({ profile: { id: 'p1' } }, 201);
      if (url === '/api/ai-profiles/p1/activate' && method === 'POST') return json({ profile: { id: 'p1' } });
      if (url === '/api/settings/instance') return json({ settings: { publicUrl: 'http://localhost:7080', trustProxy: false, allowPrivateUrls: false }, restartRequired: false });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWizard();
    await screen.findByText('Use o token definido em SETUP_TOKEN');
    await userEvent.type(screen.getByLabelText('Token de setup'), 'token-de-setup-de-teste-123456');
    await userEvent.type(screen.getByLabelText('Usuário'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-segura');
    await userEvent.type(screen.getByLabelText('Confirmar senha'), 'senha-muito-segura');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    await screen.findByRole('heading', { name: /GitHub/i });
    await userEvent.click(screen.getByRole('button', { name: 'Pular por agora' }));
    await screen.findByRole('heading', { name: /Perfil de IA/i });
    await userEvent.type(screen.getByLabelText('Nome'), 'Principal');
    await userEvent.type(screen.getByLabelText('Modelo'), 'gpt-test');
    await userEvent.type(screen.getByLabelText('Chave de API'), 'sk-test');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
    await screen.findByRole('heading', { name: /Configurações da instância/i });

    const post = fetchMock.mock.calls.find(
      ([input, init]) => String(input) === '/api/ai-profiles' && init?.method === 'POST',
    );
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      name: 'Principal',
      provider: 'openai_compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-test',
      apiKey: 'sk-test',
      temperature: 0.2,
      maxOutputTokens: 4096,
      maxTurns: 20,
      maxTotalTokens: 200000,
      maxDurationSec: 600,
      maxFindings: 25,
      maxGithubCalls: 80,
      prePrompt: '',
      skillIds: [],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/ai-profiles/p1/activate', expect.objectContaining({ method: 'POST' }));
  });

  it('mostra setup concluído com link para o painel quando o setup já terminou', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/setup/status') return json({ needsSetup: false });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWizard();

    expect(await screen.findByRole('heading', { name: 'Setup concluído' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para o painel' })).toHaveAttribute('href', '/');
    expect(screen.queryByLabelText('Token de setup')).not.toBeInTheDocument();
  });

  it('reaproveita o perfil criado e repete apenas a ativação após falha', async () => {
    let createCalls = 0;
    let activateCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/setup/status') return json({ needsSetup: true, tokenSource: 'env' });
      if (url === '/api/setup' && method === 'POST') return json({ userId: 'u1' }, 201);
      if (url === '/api/ai-profiles' && method === 'POST') {
        createCalls += 1;
        return json({ profile: { id: 'p1' } }, 201);
      }
      if (url === '/api/ai-profiles/p1/activate' && method === 'POST') {
        activateCalls += 1;
        if (activateCalls === 1) {
          return json({ error: { code: 'provider_error', message: 'Provider indisponível' } }, 500);
        }
        return json({ profile: { id: 'p1' } });
      }
      if (url === '/api/settings/instance') {
        return json({ settings: { publicUrl: 'http://localhost:7080', trustProxy: false, allowPrivateUrls: false }, restartRequired: false });
      }
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWizard();
    await screen.findByText('Use o token definido em SETUP_TOKEN');
    await userEvent.type(screen.getByLabelText('Token de setup'), 'token-de-setup-de-teste-123456');
    await userEvent.type(screen.getByLabelText('Usuário'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-segura');
    await userEvent.type(screen.getByLabelText('Confirmar senha'), 'senha-muito-segura');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    await screen.findByRole('heading', { name: /GitHub/i });
    await userEvent.click(screen.getByRole('button', { name: 'Pular por agora' }));
    await screen.findByRole('heading', { name: /Perfil de IA/i });
    await userEvent.type(screen.getByLabelText('Nome'), 'Principal');
    await userEvent.type(screen.getByLabelText('Modelo'), 'gpt-test');
    await userEvent.type(screen.getByLabelText('Chave de API'), 'sk-test');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));

    expect(await screen.findByText(/Falha ao ativar o perfil de IA/)).toBeInTheDocument();
    expect(createCalls).toBe(1);
    expect(activateCalls).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
    expect(await screen.findByRole('heading', { name: /Configurações da instância/i })).toBeInTheDocument();
    expect(createCalls).toBe(1);
    expect(activateCalls).toBe(2);
  });
});
