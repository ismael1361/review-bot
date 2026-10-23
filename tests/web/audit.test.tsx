// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Audit } from '../../src/web/pages/settings/Audit';

type Entry = {
  id: string;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  createdAt: number;
};

const base = Date.UTC(2026, 0, 31, 12);

function entry(index: number, createdAt: number): Entry {
  return {
    id: `a${index}`,
    userId: `usuario-${index}`,
    action: `acao-${index}`,
    targetType: 'user',
    targetId: `t${index}`,
    ip: `10.0.0.${index}`,
    createdAt,
  };
}

const firstPage = Array.from({ length: 20 }, (_, index) => entry(index + 1, base - index * 86_400_000));
const secondPage = [entry(21, base - 20 * 86_400_000)];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function renderAudit() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Audit />
    </QueryClientProvider>,
  );
}

describe('Audit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lista entradas paginadas e navega para a próxima página', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/audit?page=1&limit=20') {
        return json({ entries: firstPage, total: 21 });
      }
      if (url === '/api/audit?page=2&limit=20') {
        return json({ entries: secondPage, total: 21 });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderAudit();

    expect(await screen.findByText('acao-1')).toBeInTheDocument();
    expect(screen.getByText('usuario-1')).toBeInTheDocument();
    expect(screen.getByText('user/t1')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.1')).toBeInTheDocument();
    expect(screen.getByText(new Date(firstPage[0]!.createdAt).toLocaleString('pt-BR'))).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));

    expect(await screen.findByText('acao-21')).toBeInTheDocument();
    expect(screen.getByText('usuario-21')).toBeInTheDocument();
    expect(screen.getByText('user/t21')).toBeInTheDocument();
    expect(screen.getByText('10.0.0.21')).toBeInTheDocument();
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/audit?page=2&limit=20')).toBe(true);
  });
});
