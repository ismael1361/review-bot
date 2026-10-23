// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Users } from '../../src/web/pages/settings/Users';

const alice = { id: 'u1', username: 'alice', role: 'viewer', isRoot: false, disabled: false };
const root = { id: 'u0', username: 'root', role: 'admin', isRoot: true, disabled: false };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function renderUsers() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Users />
    </QueryClientProvider>,
  );
}

describe('Users', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('altera o papel de um usuário e envia PATCH com role', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/users' && method === 'GET') {
        return json({ users: [alice, root] });
      }
      if (url === '/api/users/u1' && method === 'PATCH') {
        return json({ user: { ...alice, role: 'operator' } });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderUsers();

    await userEvent.selectOptions(await screen.findByLabelText('Papel de alice'), 'operator');

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === '/api/users/u1' && (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body).toEqual({ role: 'operator' });
    });
    expect(screen.queryByLabelText('Papel de root')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Desativar' })).toHaveLength(1);
  });

  it('redefine a senha de um usuário e envia POST com a nova senha', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/users' && method === 'GET') {
        return json({ users: [alice] });
      }
      if (url === '/api/users/u1/reset-password' && method === 'POST') {
        return new Response(null, { status: 204 });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderUsers();

    await userEvent.click(await screen.findByRole('button', { name: 'Redefinir senha de alice' }));
    const password = screen.getByLabelText('Nova senha de alice');
    expect(password).toHaveAttribute('type', 'password');
    await userEvent.type(password, 'senha-nova-123456');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === '/api/users/u1/reset-password' && (init as RequestInit | undefined)?.method === 'POST',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body).toEqual({ password: 'senha-nova-123456' });
    });
    expect(await screen.findByText('Senha redefinida.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nova senha de alice')).not.toBeInTheDocument();
  });
});
