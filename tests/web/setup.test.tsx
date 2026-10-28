// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Setup } from '../../src/web/pages/Setup';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function setupFetchMock(tokenSource: 'env' | 'generated', setupToken?: string) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === '/api/setup/status') {
      return json({ needsSetup: true, tokenSource, setupToken: tokenSource === 'generated' ? setupToken : undefined });
    }
    if (url === '/api/setup') {
      return json({ userId: '1' }, 201);
    }
    return json({}, 404);
  });
}

function renderSetup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Setup />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Setup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra erro quando as senhas não coincidem', async () => {
    vi.stubGlobal('fetch', setupFetchMock('env'));
    renderSetup();
    expect(await screen.findByText('Use o token definido em SETUP_TOKEN')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-longa');
    await userEvent.type(screen.getByLabelText('Confirmar senha'), 'outra-senha-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    expect(await screen.findByText('As senhas não coincidem.')).toBeInTheDocument();
  });

  it('envia o setup quando os dados são válidos', async () => {
    const fetchMock = setupFetchMock('env');
    vi.stubGlobal('fetch', fetchMock);
    renderSetup();
    await userEvent.type(await screen.findByLabelText('Token de setup'), 'token-de-setup-de-teste-123456');
    await userEvent.type(screen.getByLabelText('Usuário'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-longa');
    await userEvent.type(screen.getByLabelText('Confirmar senha'), 'senha-muito-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/setup', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByRole('heading', { name: /GitHub/i })).toBeInTheDocument();
  });

  it('exibe o token gerado em modo somente leitura com botão de copiar e o aviso', async () => {
    vi.stubGlobal('fetch', setupFetchMock('generated', 'token-gerado-123456'));
    renderSetup();
    const input = await screen.findByLabelText('Token de setup');
    await waitFor(() => expect(input).toHaveValue('token-gerado-123456'));
    expect(input).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Copiar token' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Qualquer pessoa com acesso a esta instância antes de concluir o setup pode criar o root. Conclua agora ou defina SETUP_TOKEN no .env.',
      ),
    ).toBeInTheDocument();
  });
});
