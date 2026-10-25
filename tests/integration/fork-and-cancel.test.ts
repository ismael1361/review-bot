import { describe, expect, it, vi } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import type { ChatResult } from '../../src/ai/adapters/types';
import { runAgentLoop } from '../../src/ai/loop';
import { executeTool, type ToolContext } from '../../src/ai/tools';
import { jobs, repositories } from '../../src/db/schema';
import { createEventBus } from '../../src/events/bus';
import { CancelledError } from '../../src/jobs/worker';
import { createTestDb } from '../helpers/db';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setupJob(headRepo?: string): { db: ReturnType<typeof createTestDb>; job: ToolContext['job'] } {
  const db = createTestDb();
  const now = Date.now();
  db.insert(repositories)
    .values({
      id: 'r1',
      githubId: '1',
      owner: 'acme',
      name: 'api',
      fullName: 'acme/api',
      private: true,
      archived: false,
      enabled: true,
      discoveredAt: now,
      updatedAt: now,
    })
    .run();
  const id = uuidv7();
  db.insert(jobs)
    .values({
      id,
      repositoryId: 'r1',
      prNumber: 7,
      prTitle: 't',
      prUrl: 'u',
      authorLogin: 'x',
      headSha: 'sha',
      baseSha: 'b',
      headRepo,
      runSeq: 1,
      status: 'running',
      priority: 0,
      attempts: 1,
      maxAttempts: 3,
      queuedAt: now,
    })
    .run();
  return { db, job: db.select().from(jobs).get()! };
}

describe('fork e cancelamento', () => {
  it('lê arquivos do repositório head do job', async () => {
    const { db, job } = setupJob('fork/api');
    expect(job.headRepo).toBe('fork/api');

    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      seen.push(String(url));
      return jsonResponse({ content: Buffer.from('const a = 1;').toString('base64'), encoding: 'base64' });
    }) as unknown as typeof fetch;
    const context: ToolContext = {
      db,
      job,
      token: 't',
      fetchImpl,
      baseRepo: { owner: 'acme', name: 'api' },
      headRepoFullName: 'fork/api',
      headSha: 'sha',
      prNumber: 7,
      files: [],
      validLines: new Map(),
      calls: { count: 0, max: 80 },
      searchCalls: { count: 0, max: 5 },
      maxFindings: 25,
    };

    const result = await executeTool('read_file', JSON.stringify({ path: 'src/a.ts' }), context);

    expect(result.content).toBe('const a = 1;');
    expect(seen.some((url) => url.includes('/repos/fork/api/contents/src/a.ts'))).toBe(true);
    expect(seen.some((url) => url.includes('/repos/acme/api/contents/'))).toBe(false);
  });

  it('interrompe o loop entre turnos quando o job é cancelado', async () => {
    const { db, job } = setupJob();
    let cancelled = false;
    let chatCalls = 0;
    const chatImpl = async (): Promise<ChatResult> => {
      chatCalls += 1;
      cancelled = true;
      return { toolCalls: [], usage: { input: 1, output: 1 }, finishReason: 'stop' };
    };

    let error: unknown;
    try {
      await runAgentLoop({
        db,
        bus: createEventBus(),
        job,
        profileSnapshot: {
          name: 'p',
          provider: 'openai_compatible',
          model: 'm',
          temperature: 0.2,
          maxOutputTokens: 100,
          maxTurns: 5,
          maxTotalTokens: 10000,
          maxDurationSec: 60,
          maxFindings: 5,
          maxGithubCalls: 10,
          prePrompt: '',
        },
        baseUrl: 'https://p.exemplo.com/v1',
        apiKey: 'k',
        skills: [],
        userPrompt: 'analise',
        shouldCancel: () => cancelled,
        chatImpl,
        tools: {
          db,
          job,
          token: 't',
          baseRepo: { owner: 'acme', name: 'api' },
          headRepoFullName: 'acme/api',
          headSha: 'sha',
          prNumber: 7,
          files: [],
          validLines: new Map(),
          calls: { count: 0, max: 10 },
          searchCalls: { count: 0, max: 1 },
          maxFindings: 5,
        },
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(CancelledError);
    expect((error as Error).message).toBe('job_cancelled');
    expect(chatCalls).toBe(1);
  });
});
