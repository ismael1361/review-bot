import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { ChatInput, ChatResult } from '../../src/ai/adapters/types';
import { activateProfile, createProfile, type ProfileInputType } from '../../src/ai/profiles';
import type { AppDeps } from '../../src/api/app';
import { events, jobs, repositories, reviews } from '../../src/db/schema';
import { saveGithubCredentials } from '../../src/github/credentials';
import { executeJob } from '../../src/jobs/execute';
import { RetryableJobError, cancelJob } from '../../src/jobs/queue';
import type { WorkerDeps } from '../../src/jobs/worker';
import { createTestApp } from '../helpers/app';

const TOKEN = 'ghp_1234567890abcdefghij';
const PUBLIC_LOOKUP = async () => ['93.184.216.34'];

const PATCH = ['@@ -40,6 +40,7 @@', '   const row = x;', '+  const now = Date.now();', '   const user = y;'].join('\n');

const PROFILE_INPUT: ProfileInputType = {
  name: 'p1',
  provider: 'openai_compatible',
  baseUrl: 'https://p.exemplo.com/v1',
  model: 'm',
  apiKey: 'k',
  temperature: 0.2,
  maxOutputTokens: 4096,
  maxTurns: 10,
  maxTotalTokens: 100000,
  maxDurationSec: 600,
  maxFindings: 25,
  maxGithubCalls: 80,
  prePrompt: '',
  skillIds: [],
};

type GithubRecord = { posts: { comments?: unknown[]; body?: string }[]; urls: string[] };

type FakeOptions = {
  headRepo?: string | null;
  headSha?: string;
  files?: unknown[];
  reviews?: unknown[];
  comments?: unknown[];
  reviewPostStatus?: number;
  draft?: boolean;
};

const DEFAULT_METADATA = {
  title: 'fix: x',
  body: 'Corpo da PR',
  state: 'open',
  draft: true,
  additions: 12,
  deletions: 3,
  changed_files: 2,
  head: { sha: 'sha1', ref: 'feature/x', repo: { full_name: 'fork/b' } },
  base: { sha: 'base', ref: 'main' },
  user: { login: 'octocat' },
};

const DEFAULT_REVIEWS = [
  { id: 5, body: 'Review anterior', state: 'COMMENTED', html_url: 'https://github.com/a/b/pull/7#review-5', user: { login: 'rev' } },
];

const DEFAULT_COMMENTS = [{ body: 'Comentário anterior', path: 'src/a.ts', line: 40, user: { login: 'octo' } }];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function setup(overrides: { baseUrl?: string; snapshot?: Record<string, unknown> } = {}) {
  const { app, deps } = await createTestApp();
  await app.close();
  saveGithubCredentials(deps.db, deps.encryptionKey, { login: 'bot', pat: TOKEN, scopes: 'repo' });
  const baseUrl = overrides.baseUrl ?? PROFILE_INPUT.baseUrl;
  const profile = createProfile(deps.db, deps.encryptionKey, { ...PROFILE_INPUT, baseUrl });
  activateProfile(deps.db, profile.id);
  const now = Date.now();
  deps.db
    .insert(repositories)
    .values({
      id: 'r1',
      githubId: '1',
      owner: 'a',
      name: 'b',
      fullName: 'a/b',
      private: true,
      archived: false,
      enabled: true,
      discoveredAt: now,
      updatedAt: now,
    })
    .run();
  const jobId = uuidv7();
  const snapshot = {
    id: profile.id,
    name: 'p1',
    provider: 'openai_compatible',
    baseUrl,
    model: 'm',
    temperature: 0.2,
    maxOutputTokens: 4096,
    maxTurns: 10,
    maxTotalTokens: 100000,
    maxDurationSec: 600,
    maxFindings: 25,
    maxGithubCalls: 80,
    prePrompt: '',
    ...overrides.snapshot,
  };
  deps.db
    .insert(jobs)
    .values({
      id: jobId,
      repositoryId: 'r1',
      prNumber: 7,
      prTitle: 'fix: x',
      prUrl: 'u',
      authorLogin: 'octocat',
      headSha: 'sha1',
      baseSha: 'base',
      runSeq: 1,
      status: 'running',
      priority: 0,
      attempts: 1,
      maxAttempts: 3,
      profileId: profile.id,
      profileSnapshotJson: JSON.stringify(snapshot),
      queuedAt: now,
      heartbeatAt: now,
      lockedBy: 'w1',
    })
    .run();
  return { deps, job: deps.db.select().from(jobs).where(eq(jobs.id, jobId)).get()! };
}

function githubFetch(record: GithubRecord, options: FakeOptions = {}) {
  const metadata = {
    ...DEFAULT_METADATA,
    draft: options.draft ?? DEFAULT_METADATA.draft,
    head: {
      sha: options.headSha ?? DEFAULT_METADATA.head.sha,
      ref: DEFAULT_METADATA.head.ref,
      repo: options.headRepo === null ? null : { full_name: options.headRepo ?? DEFAULT_METADATA.head.repo.full_name },
    },
  };
  const files = options.files ?? [{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, patch: PATCH }];
  const reviewList = options.reviews ?? DEFAULT_REVIEWS;
  const commentList = options.comments ?? DEFAULT_COMMENTS;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    record.urls.push(url);
    const method = init?.method ?? 'GET';
    if (url.endsWith('/pulls/7')) {
      return jsonResponse(metadata);
    }
    if (url.includes('/pulls/7/files')) {
      return jsonResponse(files);
    }
    if (url.includes('/pulls/7/commits')) {
      return jsonResponse([{ sha: 'sha1', commit: { message: 'fix: x' } }]);
    }
    if (url.includes('/pulls/7/comments')) {
      return jsonResponse(commentList);
    }
    if (url.includes('/pulls/7/reviews') && method === 'POST') {
      if (options.reviewPostStatus && options.reviewPostStatus >= 400) {
        return new Response('falha simulada', { status: options.reviewPostStatus });
      }
      record.posts.push(JSON.parse(String(init?.body)));
      return jsonResponse({ id: 42, html_url: 'https://github.com/a/b/pull/7#review' });
    }
    if (url.includes('/pulls/7/reviews')) {
      return jsonResponse(reviewList);
    }
    if (url.includes('/contents/')) {
      return jsonResponse({ content: Buffer.from('const a = 1;').toString('base64'), encoding: 'base64' });
    }
    return new Response('{}', { status: 404 });
  });
}

function workerDeps(
  deps: AppDeps,
  fetchImpl: typeof fetch,
  chatImpl?: (input: ChatInput) => Promise<ChatResult>,
): WorkerDeps {
  return {
    db: deps.db,
    bus: deps.bus,
    logger: deps.logger,
    encryptionKey: deps.encryptionKey,
    fetchImpl,
    chatImpl,
    handler: executeJob,
    allowPrivate: false,
    lookup: PUBLIC_LOOKUP,
  };
}

let callSeq = 0;

function toolCall(name: string, args: unknown): ChatResult {
  callSeq += 1;
  return {
    toolCalls: [{ id: `call-${callSeq}`, name, argumentsJson: JSON.stringify(args) }],
    usage: { input: 10, output: 5 },
    finishReason: 'tool_calls',
  };
}

function scripted(results: ChatResult[]): { inputs: ChatInput[]; chatImpl: (input: ChatInput) => Promise<ChatResult> } {
  const inputs: ChatInput[] = [];
  return {
    inputs,
    chatImpl: async (input) => {
      inputs.push(input);
      const next = results.shift();
      if (!next) {
        throw new Error('Script de chat esgotado');
      }
      return next;
    },
  };
}

function userPrompt(input: ChatInput): string {
  const message = input.messages.find((entry) => entry.role === 'user');
  if (!message || message.role !== 'user') {
    throw new Error('Prompt do usuário ausente');
  }
  return message.content;
}

function largePatch(label: string, bytes: number): string {
  const header = '@@ -1,2 +1,2 @@\n';
  const line = `+${label} ${'x'.repeat(240)}\n`;
  const repetitions = Math.ceil((bytes - header.length) / line.length);
  return header + line.repeat(repetitions);
}

describe('executeJob', () => {
  it('executa o fluxo completo e publica o review uma única vez', async () => {
    const { deps, job } = await setup();
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record);
    const script = scripted([
      toolCall('add_finding', { path: 'src/a.ts', line: 41, severity: 'critical', title: 'Bug', body: 'corpo' }),
      toolCall('submit_review', { summary: 'Resumo técnico do review.' }),
    ]);
    const busEvents: string[] = [];
    deps.bus.subscribe((event) => busEvents.push(event.type));

    const result = await executeJob(
      job,
      workerDeps(deps, fetchMock as unknown as typeof fetch, script.chatImpl),
    );

    expect(result.status).toBe('succeeded');
    const usage = JSON.parse(result.usageJson) as {
      input: number;
      output: number;
      turns: number;
      githubCalls: number;
      durationMs: number;
    };
    expect(usage).toMatchObject({ input: 20, output: 10, turns: 2, githubCalls: 0 });
    expect(usage.durationMs).toBeGreaterThanOrEqual(0);
    expect(record.posts).toHaveLength(1);
    expect(record.posts[0]!.comments).toHaveLength(1);
    expect(deps.db.select().from(reviews).get()!.status).toBe('posted');
    expect(busEvents).toContain('review.published');

    const prompt = userPrompt(script.inputs[0]!);
    expect(prompt).toContain('Corpo da PR');
    expect(prompt).toContain('Estado: open (rascunho)');
    expect(prompt).toContain('Branches: feature/x → main');
    expect(prompt).toContain('Alterações: +12/-3 em 2 arquivo(s)');
    expect(prompt).toContain('Review anterior');
    expect(prompt).toContain('Comentário anterior');
    expect(prompt).toContain('modified src/a.ts (+1/-0)');
  });

  it('usa o repositório head do fork nas leituras de arquivo', async () => {
    const { deps, job } = await setup();
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record, { headRepo: 'fork/b' });
    const script = scripted([
      toolCall('read_file', { path: 'src/a.ts' }),
      toolCall('submit_review', { summary: 'Resumo técnico com leitura do fork.' }),
    ]);

    const result = await executeJob(
      job,
      workerDeps(deps, fetchMock as unknown as typeof fetch, script.chatImpl),
    );

    expect(result.status).toBe('succeeded');
    expect(record.urls.some((url) => url.includes('/repos/fork/b/contents/src/a.ts'))).toBe(true);
    expect(record.urls.some((url) => url.includes('/repos/a/b/contents/'))).toBe(false);
    expect(record.urls.some((url) => url.includes('/repos/a/b/pulls/7/reviews'))).toBe(true);
  });

  it('rejeita snapshot de perfil inválido antes de qualquer chamada externa', async () => {
    const { deps, job } = await setup();
    deps.db
      .update(jobs)
      .set({ profileSnapshotJson: JSON.stringify({ provider: 'openai_compatible', baseUrl: 'https://p.exemplo.com/v1' }) })
      .where(eq(jobs.id, job.id))
      .run();
    const broken = deps.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record);
    const chat = vi.fn(async () => {
      throw new Error('não deveria chamar o chat');
    });

    await expect(
      executeJob(broken, workerDeps(deps, fetchMock as unknown as typeof fetch, chat)),
    ).rejects.toThrow(/Snapshot do perfil inválido/);
    expect(chat).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita job quando a PR avançou para outro head', async () => {
    const { deps, job } = await setup();
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record, { headSha: 'sha2' });
    const chat = vi.fn(async () => {
      throw new Error('não deveria chamar o chat');
    });

    await expect(
      executeJob(job, workerDeps(deps, fetchMock as unknown as typeof fetch, chat)),
    ).rejects.toThrow(/PR desatualizada/);
    expect(chat).not.toHaveBeenCalled();
    expect(record.urls).toHaveLength(1);
  });

  it('rejeita base URL privada antes de qualquer chamada de chat', async () => {
    const { deps, job } = await setup({ baseUrl: 'http://127.0.0.1:8080/v1' });
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record);
    const chat = vi.fn(async () => {
      throw new Error('não deveria chamar o chat');
    });

    await expect(
      executeJob(job, workerDeps(deps, fetchMock as unknown as typeof fetch, chat)),
    ).rejects.toThrow(/Endereço privado não permitido/);
    expect(chat).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('mapeia falha retentável de publicação para RetryableJobError', async () => {
    const { deps, job } = await setup();
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record, { reviewPostStatus: 500 });
    const script = scripted([toolCall('submit_review', { summary: 'Resumo técnico que falha ao publicar.' })]);

    await expect(
      executeJob(job, workerDeps(deps, fetchMock as unknown as typeof fetch, script.chatImpl)),
    ).rejects.toBeInstanceOf(RetryableJobError);
    expect(record.posts).toHaveLength(0);
    expect(deps.db.select().from(reviews).get()!.status).toBe('failed');
  });

  it('não publica review de job cancelado', async () => {
    const { deps, job } = await setup();
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record);
    const script = scripted([toolCall('submit_review', { summary: 'Resumo técnico de job cancelado.' })]);
    const chatImpl = async (input: ChatInput): Promise<ChatResult> => {
      cancelJob(deps.db, job.id);
      return script.chatImpl(input);
    };

    const result = await executeJob(job, workerDeps(deps, fetchMock as unknown as typeof fetch, chatImpl));

    expect(result.status).toBe('succeeded');
    expect(record.posts).toHaveLength(0);
    expect(deps.db.select().from(reviews).all()).toHaveLength(0);
    expect(deps.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.status).toBe('cancelled');
  });

  it('trunca patches por bytes, prioriza código e registra evento de progresso', async () => {
    const { deps, job } = await setup();
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record, {
      files: [
        { filename: 'tests/big.test.ts', status: 'modified', additions: 1, deletions: 0, patch: largePatch('test', 450_000) },
        { filename: 'src/big.ts', status: 'modified', additions: 1, deletions: 0, patch: largePatch('src', 700_000) },
      ],
    });
    const script = scripted([toolCall('submit_review', { summary: 'Resumo técnico com diff truncado.' })]);

    const result = await executeJob(
      job,
      workerDeps(deps, fetchMock as unknown as typeof fetch, script.chatImpl),
    );

    expect(result.status).toBe('succeeded');
    const progress = deps.db
      .select()
      .from(events)
      .where(eq(events.jobId, job.id))
      .all()
      .filter((event) => event.type === 'job.progress');
    expect(progress).toHaveLength(1);
    expect(JSON.parse(progress[0]!.dataJson!)).toMatchObject({ filesIncluded: 2, patchesOmitted: 1 });
    const prompt = userPrompt(script.inputs[0]!);
    expect(prompt).toContain('diff truncado');
    expect(prompt).toContain('tests/big.test.ts (+1/-0) (patch omitido)');
    expect(prompt).toContain('modified src/big.ts (+1/-0)');
  });
});
