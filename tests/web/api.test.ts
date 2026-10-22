// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/web/api';

function requestHeaders(fetchMock: ReturnType<typeof vi.fn>, index = 0): Record<string, string> {
  const options = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return (options?.headers ?? {}) as Record<string, string>;
}

describe('api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('não envia content-type em requisição sem body', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/api/auth/logout', { method: 'POST' });
    expect(requestHeaders(fetchMock)['content-type']).toBeUndefined();
  });

  it('envia content-type application/json quando há body', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/x', { method: 'POST', body: '{}' });
    expect(requestHeaders(fetchMock)['content-type']).toBe('application/json');
  });

  it('preserva headers enviados pelo chamador', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await api('/x', { method: 'POST', body: '{}', headers: { 'x-custom': 'abc' } });
    const headers = requestHeaders(fetchMock);
    expect(headers['x-custom']).toBe('abc');
    expect(headers['content-type']).toBe('application/json');
  });
});
