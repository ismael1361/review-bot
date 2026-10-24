import type { Db } from '../db/client';
import { getCache, putCache } from './cache';

const API_BASE = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean, readonly bodyExcerpt: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

export function classifyGitHubStatus(status: number, headers: Headers): { retryable: boolean; retryAfterMs?: number } {
  if (status === 429) {
    const retryAfter = headers.get('retry-after');
    return { retryable: true, retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : 60_000 };
  }
  if (status === 403 && headers.get('x-ratelimit-remaining') === '0') {
    const reset = headers.get('x-ratelimit-reset');
    const retryAfterMs = reset ? Math.max(0, Number(reset) * 1000 - Date.now()) : 60_000;
    return { retryable: true, retryAfterMs };
  }
  if (status >= 500) {
    return { retryable: true };
  }
  return { retryable: false };
}

function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'review-bot',
    'x-github-api-version': '2022-11-28',
    ...extra,
  };
}

const FETCH_TIMEOUT_MS = 30_000;

function networkFailure(url: string, error: unknown): GitHubError {
  const label = url.startsWith(API_BASE) ? url.slice(API_BASE.length) : url;
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const excerpt = detail.slice(0, 300);
  return new GitHubError(`Falha de rede em ${label}: ${excerpt}`, 502, true, excerpt);
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof GitHubError) {
      throw error;
    }
    throw networkFailure(url, error);
  }
}

export async function githubFetch(path: string, options: { token: string; fetchImpl?: typeof fetch; method?: string; body?: unknown; etag?: string }): Promise<{ response: Response; notModified: boolean }> {
  const response = await fetchWithTimeout(options.fetchImpl ?? fetch, `${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: headers(options.token, {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.etag ? { 'if-none-match': options.etag } : {}),
    }),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 304) {
    return { response, notModified: true };
  }
  if (!response.ok) {
    const excerpt = (await response.text()).slice(0, 300);
    const { retryable, retryAfterMs } = classifyGitHubStatus(response.status, response.headers);
    throw new GitHubError(`GitHub ${response.status} em ${path}: ${excerpt}`, response.status, retryable, excerpt, retryAfterMs);
  }
  return { response, notModified: false };
}

export async function githubJson<T>(path: string, options: { token: string; fetchImpl?: typeof fetch; cache?: { db: Db; key?: string; ttlMs?: number } }): Promise<{ data: T; etag?: string }> {
  const cacheKey = options.cache?.key ?? path;
  const cached = options.cache ? getCache(options.cache.db, cacheKey) : undefined;
  const { response, notModified } = await githubFetch(path, { token: options.token, fetchImpl: options.fetchImpl, etag: cached?.etag });
  if (notModified) {
    if (!cached) {
      throw new GitHubError(`GitHub 304 sem cache em ${path}`, 502, true, '');
    }
    return { data: JSON.parse(cached.payloadJson) as T, etag: cached.etag };
  }
  const etag = response.headers.get('etag') ?? undefined;
  const data = (await response.json()) as T;
  if (options.cache && etag) {
    putCache(options.cache.db, cacheKey, etag, JSON.stringify(data), options.cache.ttlMs ?? 60_000);
  }
  return { data, etag };
}

function pageItems<T>(payload: unknown): T[] | undefined {
  if (Array.isArray(payload)) {
    return payload as T[];
  }
  if (typeof payload === 'object' && payload !== null && 'items' in payload && Array.isArray(payload.items)) {
    return payload.items as T[];
  }
  return undefined;
}

export async function paginate<T>(path: string, options: { token: string; fetchImpl?: typeof fetch; perPage?: number; maxPages?: number }): Promise<T[]> {
  const perPage = options.perPage ?? 100;
  const maxPages = options.maxPages ?? 10;
  const results: T[] = [];
  let url: string | undefined = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}per_page=${perPage}`;
  let page = 0;
  while (url && page < maxPages) {
    const response = await fetchWithTimeout(options.fetchImpl ?? fetch, url, { headers: headers(options.token) });
    if (!response.ok) {
      const excerpt = (await response.text()).slice(0, 300);
      const { retryable, retryAfterMs } = classifyGitHubStatus(response.status, response.headers);
      throw new GitHubError(`GitHub ${response.status} em ${url}: ${excerpt}`, response.status, retryable, excerpt, retryAfterMs);
    }
    const items = pageItems<T>(await response.json());
    if (!items) {
      throw new GitHubError(`Resposta inesperada do GitHub em ${url}`, 502, true, '');
    }
    results.push(...items);
    url = nextLink(response.headers.get('link'));
    page += 1;
  }
  return results;
}

export function nextLink(linkHeader: string | null): string | undefined {
  if (!linkHeader) {
    return undefined;
  }
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

export async function testConnection(pat: string, fetchImpl?: typeof fetch): Promise<{ login: string; scopes: string }> {
  const response = await fetchWithTimeout(fetchImpl ?? fetch, `${API_BASE}/user`, { headers: headers(pat) });
  if (!response.ok) {
    const excerpt = (await response.text()).slice(0, 300);
    const { retryable, retryAfterMs } = classifyGitHubStatus(response.status, response.headers);
    throw new GitHubError(`Token rejeitado pelo GitHub (${response.status})`, response.status, retryable, excerpt, retryAfterMs);
  }
  const data = (await response.json()) as { login?: string };
  if (!data.login) {
    throw new GitHubError('Resposta inesperada do GitHub', 502, true, '');
  }
  return { login: data.login, scopes: response.headers.get('x-oauth-scopes') ?? '' };
}
