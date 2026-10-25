import { and, eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { ChatInput, ChatResult } from '../../src/ai/adapters/types';
import { activateProfile, createProfile, type ProfileInputType } from '../../src/ai/profiles';
import type { AppDeps } from '../../src/api/app';
import { events, jobs, repositories, reviews } from '../../src/db/schema';
import { saveGithubCredentials } from '../../src/github/credentials';
import { executeJob } from '../../src/jobs/execute';
import { RetryableJobError, cancelJob, retryJob } from '../../src/jobs/queue';
import { createWorker, type WorkerDeps } from '../../src/jobs/worker';
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
    if (url.includes('/search/code')) {
      return jsonResponse({ items: [{ path: 'src/a.ts' }] });
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

  it('prioriza o repositório head persistido no job', async () => {
    const { deps, job } = await setup();
    deps.db.update(jobs).set({ headRepo: 'fork/api' }).where(eq(jobs.id, job.id)).run();
    const updated = deps.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record, { headRepo: 'other/repo' });
    const script = scripted([
      toolCall('read_file', { path: 'src/a.ts' }),
      toolCall('search_code', { query: 'resolveSession' }),
      toolCall('submit_review', { summary: 'Resumo técnico com leitura do fork persistido.' }),
    ]);

    const result = await executeJob(
      updated,
      workerDeps(deps, fetchMock as unknown as typeof fetch, script.chatImpl),
    );

    expect(result.status).toBe('succeeded');
    expect(record.urls.some((url) => url.includes('/repos/fork/api/contents/src/a.ts'))).toBe(true);
    expect(record.urls.some((url) => url.includes('/repos/other/repo/contents/'))).toBe(false);
    expect(record.urls.some((url) => url.includes('repo%3Aa%2Fb'))).toBe(true);
    expect(record.urls.some((url) => url.includes('repo%3Afork%2Fapi'))).toBe(false);
    expect(record.urls.some((url) => url.includes('/repos/a/b/pulls/7/reviews'))).toBe(true);
  });

  it('rejeita repositório head inválido antes de chamar o chat', async () => {
    const { deps, job } = await setup();
    deps.db.update(jobs).set({ headRepo: 'fork' }).where(eq(jobs.id, job.id)).run();
    const updated = deps.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record);
    const chat = vi.fn(async () => {
      throw new Error('não deveria chamar o chat');
    });

    await expect(
      executeJob(updated, workerDeps(deps, fetchMock as unknown as typeof fetch, chat)),
    ).rejects.toThrow('Repositório head inválido');
    expect(chat).not.toHaveBeenCalled();
    expect(record.urls).toHaveLength(1);
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

  it('retry de publicação usa o resumo persistido sem chamar o chat novamente', async () => {
    const { deps, job } = await setup();
    const failedRecord: GithubRecord = { posts: [], urls: [] };
    const failingFetch = githubFetch(failedRecord, { reviewPostStatus: 500 });
    const firstScript = scripted([toolCall('submit_review', { summary: 'Resumo persistido para retry.' })]);

    await expect(
      executeJob(job, workerDeps(deps, failingFetch as unknown as typeof fetch, firstScript.chatImpl)),
    ).rejects.toBeInstanceOf(RetryableJobError);

    const afterFailure = deps.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(afterFailure.summaryMd).toBe('Resumo persistido para retry.');
    expect(JSON.parse(afterFailure.usageJson!)).toMatchObject({ status: 'succeeded' });

    const record: GithubRecord = { posts: [], urls: [] };
    const retryFetch = githubFetch(record);
    const chat = vi.fn(async () => {
      throw new Error('não deveria chamar o chat');
    });
    const result = await executeJob(afterFailure, workerDeps(deps, retryFetch as unknown as typeof fetch, chat));

    expect(result.status).toBe('succeeded');
    expect(JSON.parse(result.usageJson)).toMatchObject({ status: 'succeeded' });
    expect(record.posts).toHaveLength(1);
    expect(chat).not.toHaveBeenCalled();
    expect(deps.db.select().from(reviews).get()!.status).toBe('posted');
  });

  it('cancelar e reprocessar durante o loop não publica nem marca o job como falho', async () => {
    const { deps, job } = await setup();
    deps.db
      .update(jobs)
      .set({ status: 'queued', attempts: 0, lockedBy: null, nextAttemptAt: Date.now() })
      .where(eq(jobs.id, job.id))
      .run();
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record);
    const script = scripted([toolCall('submit_review', { summary: 'Resumo que não deve ser publicado.' })]);
    const chatImpl = async (input: ChatInput): Promise<ChatResult> => {
      cancelJob(deps.db, job.id);
      retryJob(deps.db, job.id);
      return script.chatImpl(input);
    };

    const worker = createWorker(workerDeps(deps, fetchMock as unknown as typeof fetch, chatImpl), 'w1');
    expect(await worker.tick()).toBe(true);

    expect(record.posts).toHaveLength(0);
    const current = deps.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(current.status).toBe('queued');
    expect(current.attempts).toBe(0);
    const eventTypes = deps.db
      .select()
      .from(events)
      .where(eq(events.jobId, job.id))
      .all()
      .map((event) => event.type);
    expect(eventTypes).not.toContain('job.finished');
    expect(eventTypes).not.toContain('job.failed');
  });

  it('cancelamento cooperativo interrompe o loop sem marcar o job como falho', async () => {
    const { deps, job } = await setup();
    deps.db
      .update(jobs)
      .set({ status: 'queued', attempts: 0, lockedBy: null, nextAttemptAt: Date.now() })
      .where(eq(jobs.id, job.id))
      .run();
    const record: GithubRecord = { posts: [], urls: [] };
    const fetchMock = githubFetch(record);
    let chatCalls = 0;
    const chatImpl = async (): Promise<ChatResult> => {
      chatCalls += 1;
      cancelJob(deps.db, job.id);
      return { toolCalls: [], usage: { input: 1, output: 1 }, finishReason: 'stop' };
    };

    const worker = createWorker(workerDeps(deps, fetchMock as unknown as typeof fetch, chatImpl), 'w1');
    expect(await worker.tick()).toBe(true);

    expect(chatCalls).toBe(1);
    expect(record.posts).toHaveLength(0);
    const current = deps.db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(current.status).toBe('cancelled');
    expect(current.errorCode).toBeNull();
    const eventTypes = deps.db
      .select()
      .from(events)
      .where(eq(events.jobId, job.id))
      .all()
      .map((event) => event.type);
    expect(eventTypes).toContain('job.started');
    expect(eventTypes).toContain('job.finished');
    expect(eventTypes).not.toContain('job.failed');
    const finished = deps.db.select().from(events).where(and(eq(events.jobId, job.id), eq(events.type, 'job.finished'))).get()!;
    expect(finished.message).toBe('Job cancelado');
    expect(JSON.parse(finished.dataJson!)).toMatchObject({ status: 'cancelled' });
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
