// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/web/app';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/settings/ia']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Acesso às definições', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('viewer não vê o link Definições nem as abas, apenas o aviso de acesso restrito', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/setup/status') {
        return json({ needsSetup: false });
      }
      if (url === '/api/auth/me') {
        return json({ user: { id: '2', username: 'viewer', role: 'viewer', isRoot: false } });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Acesso restrito' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Definições' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'IA' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Skills' })).not.toBeInTheDocument();
  });
});
