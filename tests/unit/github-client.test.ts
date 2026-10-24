import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCache, putCache } from '../../src/github/cache';
import { GitHubError, classifyGitHubStatus, githubFetch, githubJson, nextLink, paginate, testConnection } from '../../src/github/client';
import { createTestDb } from '../helpers/db';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('cliente GitHub', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifica erros', () => {
    expect(classifyGitHubStatus(500, new Headers()).retryable).toBe(true);
    expect(classifyGitHubStatus(429, new Headers({ 'retry-after': '30' })).retryAfterMs).toBe(30000);
    expect(classifyGitHubStatus(403, new Headers({ 'x-ratelimit-remaining': '0' })).retryable).toBe(true);
    expect(classifyGitHubStatus(404, new Headers()).retryable).toBe(false);
    expect(classifyGitHubStatus(401, new Headers()).retryable).toBe(false);
  });

  it('lê o próximo link', () => {
    expect(nextLink('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"')).toBe('https://api.github.com/x?page=2');
    expect(nextLink(null)).toBeUndefined();
  });

  it('pagina seguindo Link', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('page=2')) {
        return jsonResponse([{ n: 2 }]);
      }
      return jsonResponse([{ n: 1 }], { headers: { link: '<https://api.github.com/x?per_page=100&page=2>; rel="next"' } });
    }) as unknown as typeof fetch;
    const all = await paginate<{ n: number }>('/x', { token: 't', fetchImpl });
    expect(all).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('pagina envelope de busca', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('page=2')) {
        return jsonResponse({ total_count: 2, incomplete_results: false, items: [{ n: 2 }] });
      }
      return jsonResponse(
        { total_count: 2, incomplete_results: false, items: [{ n: 1 }] },
        { headers: { link: '<https://api.github.com/search/issues?per_page=100&page=2>; rel="next"' } },
      );
    }) as unknown as typeof fetch;
    const all = await paginate<{ n: number }>('/search/issues', { token: 't', fetchImpl });
    expect(all).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('rejeita resposta de paginação sem array nem items', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ total_count: 0 })) as unknown as typeof fetch;
    await expect(paginate('/search/issues', { token: 't', fetchImpl })).rejects.toMatchObject({ status: 502, retryable: true });
  });

  it('propaga erro classificado', async () => {
    const fetchImpl = vi.fn(async () => new Response('erro', { status: 500 })) as unknown as typeof fetch;
    await expect(paginate('/x', { token: 't', fetchImpl })).rejects.toBeInstanceOf(GitHubError);
  });

  it('classifica indisponibilidade ao testar conexão como retryable', async () => {
    const fetchImpl = vi.fn(async () => new Response('erro', { status: 500 })) as unknown as typeof fetch;
    await expect(testConnection('t', fetchImpl)).rejects.toMatchObject({ status: 500, retryable: true });
  });

  it('classifica falha de rede como retryable em githubFetch', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const request = githubFetch('/x', { token: 't', fetchImpl });
    await expect(request).rejects.toBeInstanceOf(GitHubError);
    await expect(request).rejects.toMatchObject({ status: 502, retryable: true, bodyExcerpt: expect.stringContaining('fetch failed') });
  });

  it('classifica falha de rede como retryable em paginate', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const request = paginate('/x', { token: 't', fetchImpl });
    await expect(request).rejects.toBeInstanceOf(GitHubError);
    await expect(request).rejects.toMatchObject({ status: 502, retryable: true });
  });

  it('classifica falha de rede como retryable em testConnection', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const request = testConnection('t', fetchImpl);
    await expect(request).rejects.toBeInstanceOf(GitHubError);
    await expect(request).rejects.toMatchObject({ status: 502, retryable: true });
  });

  it('classifica abort e timeout como retryable', async () => {
    for (const failure of [
      new DOMException('The operation was aborted', 'AbortError'),
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    ]) {
      const fetchImpl = vi.fn(async () => {
        throw failure;
      }) as unknown as typeof fetch;
      const request = paginate('/x', { token: 't', fetchImpl });
      await expect(request).rejects.toBeInstanceOf(GitHubError);
      await expect(request).rejects.toMatchObject({ status: 502, retryable: true });
    }
  });

  it('lê dados do cache em 304', async () => {
    const db = createTestDb();
    const responses = [
      jsonResponse({ value: 1 }, { headers: { etag: 'W/"1"' } }),
      new Response(null, { status: 304 }),
    ];
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => responses.shift() ?? new Response(null, { status: 500 }));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    const first = await githubJson<{ value: number }>('/x', { token: 't', fetchImpl, cache: { db } });
    expect(first).toEqual({ data: { value: 1 }, etag: 'W/"1"' });

    const second = await githubJson<{ value: number }>('/x', { token: 't', fetchImpl, cache: { db } });
    expect(second).toEqual({ data: { value: 1 }, etag: 'W/"1"' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('if-none-match')).toBe('W/"1"');
  });

  it('rejeita 304 sem entrada no cache', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch;
    await expect(githubJson('/x', { token: 't', fetchImpl })).rejects.toMatchObject({ status: 502, retryable: true });
  });

  it('retorna undefined para cache ausente', () => {
    const db = createTestDb();
    expect(getCache(db, 'ausente')).toBeUndefined();
  });

  it('expira cache após o ttl', () => {
    const db = createTestDb();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    putCache(db, 'k', 'etag', '{"a":1}', 500);
    expect(getCache(db, 'k')).toEqual({ etag: 'etag', payloadJson: '{"a":1}' });
    now.mockReturnValue(1_501);
    expect(getCache(db, 'k')).toBeUndefined();
  });
});
