import { vi } from 'vitest';

export type FakeReviewComment = {
  path: string;
  line?: number;
  side?: 'RIGHT';
  start_line?: number;
  start_side?: 'RIGHT';
  body: string;
};

export type FakeReviewPost = {
  body: string;
  event?: string;
  commit_id?: string;
  comments?: FakeReviewComment[];
};

export type FakeGithubState = {
  headSha: string;
  updatedAt: string;
  title: string;
  patch: string;
  posts: FakeReviewPost[];
};

const DEFAULT_PATCH = ['@@ -40,6 +40,7 @@', '   const row = x;', '+  const now = Date.now();', '   const user = y;'].join('\n');
const FILE_SOURCE = 'const row = x;\nconst user = y;';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function createFakeGithub(overrides: Partial<FakeGithubState> = {}) {
  const state: FakeGithubState = {
    headSha: 'sha1',
    updatedAt: '2026-10-22T14:00:00Z',
    title: 'fix: valida token',
    patch: DEFAULT_PATCH,
    posts: [],
    ...overrides,
  };

  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/search/issues')) {
      return json({ items: [{ number: 7, repository_url: 'https://api.github.com/repos/acme/api', updated_at: state.updatedAt }] });
    }
    if (u.includes('/search/code')) {
      return json({ items: [{ path: 'src/a.ts' }] });
    }
    if (u.includes('/repos/acme/api/pulls/7/files')) {
      return json([{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, patch: state.patch }]);
    }
    if (u.includes('/repos/acme/api/pulls/7/commits')) {
      return json([{ sha: state.headSha, commit: { message: state.title } }]);
    }
    if (u.includes('/repos/acme/api/pulls/7/comments')) {
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as FakeReviewComment;
        return json({ id: 700 + state.posts.length, body: body.body, path: body.path, line: body.line ?? null, user: { login: 'bot' } }, 201);
      }
      return json([]);
    }
    if (u.includes('/repos/acme/api/pulls/7/reviews')) {
      if (method === 'POST') {
        state.posts.push(JSON.parse(String(init?.body)) as FakeReviewPost);
        const id = 41 + state.posts.length;
        return json({ id, html_url: `https://github.com/acme/api/pull/7#review-${id}` });
      }
      return json(
        state.posts.map((post, index) => ({
          id: 42 + index,
          body: post.body,
          state: 'COMMENTED',
          html_url: `https://github.com/acme/api/pull/7#review-${42 + index}`,
          user: { login: 'bot' },
        })),
      );
    }
    if (u.includes('/repos/acme/api/pulls/7')) {
      return json({
        title: state.title,
        body: 'Corpo da PR',
        state: 'open',
        draft: false,
        additions: 1,
        deletions: 0,
        changed_files: 1,
        html_url: 'https://github.com/acme/api/pull/7',
        head: { sha: state.headSha, ref: 'feature/x', repo: { full_name: 'acme/api' } },
        base: { sha: 'base', ref: 'main' },
        user: { login: 'octocat' },
      });
    }
    if (u.includes('/repos/acme/api/contents')) {
      const rest = decodeURIComponent(new URL(u).pathname.split('/contents')[1] ?? '');
      if (rest === '' || rest === '/') {
        return json([{ name: 'src', type: 'dir', path: 'src' }]);
      }
      if (rest === '/src' || rest === '/src/') {
        return json([{ name: 'a.ts', type: 'file', path: 'src/a.ts' }]);
      }
      return json({ content: Buffer.from(FILE_SOURCE).toString('base64'), encoding: 'base64' });
    }
    if (u.includes('/repos/acme/api/git/trees/')) {
      return json({
        tree: [
          { path: 'src', type: 'tree' },
          { path: 'src/a.ts', type: 'blob' },
        ],
        truncated: false,
      });
    }
    if (u.includes('/repos/acme/api')) {
      return json({ id: 1, full_name: 'acme/api', archived: false, private: true });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

  return { fetchImpl, state };
}
