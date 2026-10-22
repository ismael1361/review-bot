// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/web/app';

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App setup gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('não volta para /setup depois que o setup termina', async () => {
    let setupDone = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/setup/status') {
        if (setupDone) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return new Response(JSON.stringify({ needsSetup: !setupDone }), { status: 200 });
      }
      if (url === '/api/setup' && method === 'POST') {
        setupDone = true;
        return new Response(JSON.stringify({ userId: '1' }), { status: 201 });
      }
      if (url === '/api/auth/me') {
        return new Response(JSON.stringify({ user: { id: '1', username: 'root', role: 'admin', isRoot: true } }), { status: 200 });
      }
      if (url === '/api/dashboard') {
        return new Response(JSON.stringify({ queue: { queued: 0, running: 0 }, reviews: { total: 0, last24h: 0 }, failures: 0 }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Rota não encontrada' } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderApp();
    await userEvent.type(await screen.findByLabelText('Token de setup'), 'token-de-setup-de-teste-123456');
    await userEvent.type(screen.getByLabelText('Usuário root'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-longa');
    await userEvent.type(screen.getByLabelText('Confirmação da senha'), 'senha-muito-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar root' })).not.toBeInTheDocument();
  });
});
