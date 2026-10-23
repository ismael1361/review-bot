// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Password } from '../../src/web/pages/Password';
import { App } from '../../src/web/app';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function renderPassword() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Password />
    </QueryClientProvider>,
  );
}

function renderPasswordRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/password']}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillForm(currentPassword: string, newPassword: string, confirmation: string) {
  await userEvent.type(screen.getByLabelText('Senha atual'), currentPassword);
  await userEvent.type(screen.getByLabelText('Nova senha'), newPassword);
  await userEvent.type(screen.getByLabelText('Confirmação da nova senha'), confirmation);
}

describe('Password', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('não envia POST quando a nova senha tem menos de 12 caracteres', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    renderPassword();

    await fillForm('senha-atual-123456', 'curta', 'curta');
    await userEvent.click(screen.getByRole('button', { name: 'Alterar senha' }));

    expect(await screen.findByText('A nova senha deve ter ao menos 12 caracteres.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('não envia POST quando a confirmação diverge da nova senha', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    renderPassword();

    await fillForm('senha-atual-123456', 'senha-nova-123456', 'senha-nova-654321');
    await userEvent.click(screen.getByRole('button', { name: 'Alterar senha' }));

    expect(await screen.findByText('As senhas não coincidem.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('envia POST com a senha atual e a nova senha válida', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/auth/password' && init?.method === 'POST') {
        return new Response(null, { status: 204 });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPassword();

    await fillForm('senha-atual-123456', 'senha-nova-123456', 'senha-nova-123456');
    await userEvent.click(screen.getByRole('button', { name: 'Alterar senha' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === '/api/auth/password' && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body).toEqual({ currentPassword: 'senha-atual-123456', newPassword: 'senha-nova-123456' });
    });
    expect(await screen.findByText('Senha alterada.')).toBeInTheDocument();
    expect(screen.getByLabelText('Senha atual')).toHaveValue('');
    expect(screen.getByLabelText('Nova senha')).toHaveValue('');
    expect(screen.getByLabelText('Confirmação da nova senha')).toHaveValue('');
  });

  it('abre a rota /password pelo link Senha visível para não administradores', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/setup/status') {
        return json({ needsSetup: false });
      }
      if (url === '/api/auth/me') {
        return json({ user: { id: 'u1', username: 'viewer', role: 'viewer', isRoot: false } });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderPasswordRoute();

    expect(await screen.findByRole('heading', { name: 'Senha' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Senha' })).toBeInTheDocument();
    expect(screen.getByLabelText('Senha atual')).toBeInTheDocument();
  });
});
