// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Login } from '../../src/web/pages/Login';

function renderLogin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Login /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Login', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra mensagem para credenciais inválidas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'invalid_credentials', message: 'Credenciais inválidas' } }), { status: 401 })));
    renderLogin();
    await userEvent.type(screen.getByLabelText('Usuário'), 'root');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByText('Credenciais inválidas')).toBeInTheDocument();
  });
});
