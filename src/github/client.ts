const API_BASE = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(message: string, readonly status: number, readonly bodyExcerpt: string) {
    super(message);
  }
}

export async function githubFetch(path: string, options: { token: string; fetchImpl?: typeof fetch; method?: string; body?: unknown }): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${options.token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'review-bot',
      'x-github-api-version': '2022-11-28',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return response;
}
