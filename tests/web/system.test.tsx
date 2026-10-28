// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SystemSettings } from '../../src/web/pages/settings/System';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

describe('Configurações da instância', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('carrega e salva a seção Instância exibindo o aviso de reinício', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = init?.method ?? 'GET';
      if (url === '/api/settings/system') {
        return json({ settings: { pollingIntervalSec: 60, retentionDays: 30, concurrency: 1, ignoreDrafts: true, skipOwnPrs: false } });
      }
      if (url === '/api/settings/instance' && method === 'GET') {
        return json({
          settings: { publicUrl: 'https://reviews.exemplo.com', trustProxy: false, allowPrivateUrls: false },
          restartRequired: true,
        });
      }
      if (url === '/api/settings/instance' && method === 'PUT') {
        return json({
          settings: { publicUrl: 'https://reviews.exemplo.com', trustProxy: true, allowPrivateUrls: false },
          restartRequired: true,
        });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SystemSettings />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Instância' })).toBeInTheDocument();
    expect(await screen.findByLabelText('URL pública')).toHaveValue('https://reviews.exemplo.com');
    expect(await screen.findByText('Reinicie o container para aplicar TRUST_PROXY')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Confiar no proxy reverso'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar instância' }));

    expect(await screen.findByText('Reinicie o container para aplicar TRUST_PROXY')).toBeInTheDocument();
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === '/api/settings/instance' && init?.method === 'PUT',
      );
      expect(put).toBeTruthy();
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({
        publicUrl: 'https://reviews.exemplo.com',
        trustProxy: true,
        allowPrivateUrls: false,
      });
    });
  });
});
