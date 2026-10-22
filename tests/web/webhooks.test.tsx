// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Webhooks } from '../../src/web/pages/settings/Webhooks';

function renderWebhooks() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Webhooks />
    </QueryClientProvider>,
  );
}

describe('Webhooks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mostra falha quando o teste de entrega retorna ok false', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/webhooks' && init?.method === undefined) {
        return new Response(
          JSON.stringify({
            webhooks: [{ id: 'w1', url: 'https://example.com/hook', events: ['review.published'], enabled: true }],
          }),
          { status: 200 },
        );
      }
      if (url === '/api/webhooks/w1/test' && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: false }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Rota não encontrada' } }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWebhooks();
    await userEvent.click(await screen.findByRole('button', { name: 'Testar' }));
    expect(await screen.findByText('Falha na entrega.')).toBeInTheDocument();
    expect(screen.queryByText('Entrega disparada.')).not.toBeInTheDocument();
  });
});
