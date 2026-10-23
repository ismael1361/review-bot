// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Webhooks } from '../../src/web/pages/settings/Webhooks';

const webhook = { id: 'w1', url: 'https://example.com/hook', events: ['review.published'], enabled: true };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

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
    vi.restoreAllMocks();
  });

  it('mostra falha quando o teste de entrega retorna ok false', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/webhooks' && init?.method === undefined) {
        return new Response(JSON.stringify({ webhooks: [webhook] }), { status: 200 });
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

  it('edita um webhook e envia PATCH com URL, eventos e secret preenchido', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/webhooks' && method === 'GET') {
        return json({ webhooks: [webhook] });
      }
      if (url === '/api/webhooks/w1' && method === 'PATCH') {
        return json({ webhook: { ...webhook, url: 'https://example.com/novo', events: ['review.published', 'job.failed'] } });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWebhooks();

    await screen.findByText(/example\.com\/hook/);
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }));
    const urlInput = screen.getByLabelText('URL');
    expect(urlInput).toHaveValue('https://example.com/hook');
    await userEvent.clear(urlInput);
    await userEvent.type(urlInput, 'https://example.com/novo');
    await userEvent.click(screen.getByLabelText('job.failed'));
    await userEvent.type(screen.getByLabelText('Novo secret (opcional)'), 'segredo-de-teste-123456');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar webhook' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([input, init]) => String(input) === '/api/webhooks/w1' && (init as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body));
      expect(body).toEqual({
        url: 'https://example.com/novo',
        events: ['review.published', 'job.failed'],
        enabled: true,
        secret: 'segredo-de-teste-123456',
      });
    });
    expect(await screen.findByText('Webhook atualizado.')).toBeInTheDocument();
  });

  it('exclui um webhook após confirmação e envia DELETE', async () => {
    let removed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/webhooks' && method === 'GET') {
        return json({ webhooks: removed ? [] : [webhook] });
      }
      if (url === '/api/webhooks/w1' && method === 'DELETE') {
        removed = true;
        return new Response(null, { status: 204 });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWebhooks();

    await screen.findByText(/example\.com\/hook/);
    await userEvent.click(screen.getByRole('button', { name: 'Excluir' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/webhooks/w1', expect.objectContaining({ method: 'DELETE' }));
    });
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByText('Nenhum webhook ainda.')).toBeInTheDocument();
  });

  it('lista as entregas do webhook com sucesso, falha, status e tentativa', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/webhooks' && method === 'GET') {
        return json({ webhooks: [webhook] });
      }
      if (url === '/api/webhooks/w1/deliveries' && method === 'GET') {
        return json({
          deliveries: [
            {
              id: 'd1',
              webhookId: 'w1',
              event: 'review.published',
              success: true,
              statusCode: 200,
              attempt: 1,
              responseExcerpt: 'ok',
              createdAt: 1729000000000,
            },
            {
              id: 'd2',
              webhookId: 'w1',
              event: 'job.failed',
              success: false,
              statusCode: 500,
              attempt: 2,
              responseExcerpt: 'erro',
              createdAt: 1729000100000,
            },
          ],
        });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWebhooks();

    await screen.findByText(/example\.com\/hook/);
    await userEvent.click(screen.getByRole('button', { name: 'Entregas' }));

    const list = await screen.findByRole('list', { name: 'Últimas entregas' });
    expect(fetchMock).toHaveBeenCalledWith('/api/webhooks/w1/deliveries', expect.objectContaining({ credentials: 'same-origin' }));
    expect(within(list).getByText('review.published')).toBeInTheDocument();
    expect(within(list).getByText('job.failed')).toBeInTheDocument();
    expect(within(list).getByText('sucesso')).toBeInTheDocument();
    expect(within(list).getByText('falha')).toBeInTheDocument();
    expect(within(list).getByText('status 200')).toBeInTheDocument();
    expect(within(list).getByText('status 500')).toBeInTheDocument();
    expect(within(list).getByText('tentativa 2')).toBeInTheDocument();
  });

  it('mostra estado vazio quando o webhook não tem entregas', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/webhooks' && method === 'GET') {
        return json({ webhooks: [webhook] });
      }
      if (url === '/api/webhooks/w1/deliveries' && method === 'GET') {
        return json({ deliveries: [] });
      }
      return json({ error: { code: 'not_found', message: 'Rota não encontrada' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWebhooks();

    await screen.findByText(/example\.com\/hook/);
    await userEvent.click(screen.getByRole('button', { name: 'Entregas' }));

    expect(await screen.findByText('Nenhuma entrega registrada.')).toBeInTheDocument();
  });
});
