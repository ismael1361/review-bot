import { describe, expect, it, vi } from 'vitest';
import { getAdapter } from '../../src/ai/adapters';

const input = { baseUrl: 'https://provedor.exemplo.com/v1', apiKey: 'k', model: 'm' };

describe('adaptadores', () => {
  it('openai-compatible monta a URL e o corpo corretos', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await getAdapter('openai_compatible').testConnection(input, fetchImpl);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://provedor.exemplo.com/v1/chat/completions');
    expect(JSON.parse(String(init.body)).max_tokens).toBe(1);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('anthropic monta a URL e os cabeçalhos corretos', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await getAdapter('anthropic').testConnection({ ...input, baseUrl: 'https://api.anthropic.com' }, fetchImpl);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('propaga erro do provedor com status', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"nope"}', { status: 401 })) as unknown as typeof fetch;
    await expect(getAdapter('openai_compatible').testConnection(input, fetchImpl)).rejects.toThrow(/401/);
  });
});
