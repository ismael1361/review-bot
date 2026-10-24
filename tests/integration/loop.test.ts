import { describe, expect, it, vi } from 'vitest';
import type { ChatInput, ChatResult, ProviderKind } from '../../src/ai/adapters/types';
import { runAgentLoop, type LoopDeps } from '../../src/ai/loop';
import type { ProfileSnapshot } from '../../src/ai/prompt';
import type { ToolContext } from '../../src/ai/tools';
import type { Db } from '../../src/db/client';
import { agentMessages, jobs, repositories } from '../../src/db/schema';
import { createEventBus } from '../../src/events/bus';
import { GitHubError } from '../../src/github/client';
import { parseFilePatch } from '../../src/github/diff';
import { listFindings, SECRET_REDACTION_NOTE } from '../../src/jobs/findings';
import { createTestDb } from '../helpers/db';

const PATCH = [
  '@@ -40,6 +40,7 @@',
  '   const row = x;',
  '   if (!row) {',
  '     return;',
  '   }',
  '+  const now = Date.now();',
  '   const user = y;',
  '   return user;',
].join('\n');

const TOKEN = `ghp_${'a'.repeat(36)}`;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function setup(): { db: Db; bus: ReturnType<typeof createEventBus>; job: LoopDeps['job'] } {
  const db = createTestDb();
  const now = Date.now();
  db.insert(repositories)
    .values({
      id: 'r1',
      githubId: '1',
      owner: 'a',
      name: 'b',
      fullName: 'a/b',
      private: false,
      archived: false,
      enabled: true,
      discoveredAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(jobs)
    .values({
      id: 'j1',
      repositoryId: 'r1',
      prNumber: 1,
      prTitle: 't',
      prUrl: 'u',
      authorLogin: 'x',
      headSha: 's',
      baseSha: 'b',
      runSeq: 1,
      status: 'running',
      priority: 0,
      attempts: 1,
      maxAttempts: 3,
      queuedAt: now,
    })
    .run();
  return { db, bus: createEventBus(), job: db.select().from(jobs).get()! };
}

type SnapshotOverrides = Partial<Omit<ProfileSnapshot, 'provider'>> & { provider?: ProviderKind };

function snapshot(overrides: SnapshotOverrides = {}): ProfileSnapshot & { provider: ProviderKind } {
  return {
    name: 'p',
    provider: 'openai_compatible',
    model: 'm',
    temperature: 0.2,
    maxOutputTokens: 1234,
    maxTurns: 10,
    maxTotalTokens: 100000,
    maxDurationSec: 600,
    maxFindings: 25,
    maxGithubCalls: 80,
    prePrompt: '',
    ...overrides,
  };
}

function fakeGithubFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/contents/')) {
      return jsonResponse({ content: Buffer.from('const a = 1;').toString('base64'), encoding: 'base64' });
    }
    if (url.includes('/git/trees/')) {
      return jsonResponse({ tree: [] });
    }
    return jsonResponse({});
  }) as typeof fetch;
}

function toolContext(db: Db, job: LoopDeps['job'], overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    db,
    job,
    token: 't',
    fetchImpl: fakeGithubFetch(),
    baseRepo: { owner: 'a', name: 'b' },
    headRepoFullName: 'a/b',
    headSha: 's',
    prNumber: 1,
    files: [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, patch: PATCH, hunks: parseFilePatch(PATCH) }],
    validLines: new Map([['src/a.ts', new Set([44])]]),
    calls: { count: 0, max: 80 },
    searchCalls: { count: 0, max: 5 },
    maxFindings: 25,
    ...overrides,
  };
}

let callSeq = 0;

function toolCall(name: string, args: unknown, usage = { input: 10, output: 5 }): ChatResult {
  callSeq += 1;
  return {
    toolCalls: [{ id: `call-${callSeq}`, name, argumentsJson: JSON.stringify(args) }],
    usage,
    finishReason: 'tool_calls',
  };
}

function emptyResult(usage = { input: 2, output: 2 }): ChatResult {
  return { toolCalls: [], usage, finishReason: 'stop' };
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

function baseDeps(db: Db, job: LoopDeps['job'], overrides: Partial<LoopDeps> = {}): LoopDeps {
  return {
    db,
    bus: createEventBus(),
    job,
    profileSnapshot: snapshot(),
    baseUrl: 'https://p.exemplo.com/v1',
    apiKey: 'k',
    skills: [],
    tools: toolContext(db, job),
    userPrompt: 'analise',
    ...overrides,
  };
}

describe('loop agêntico', () => {
  it('executa ferramentas e finaliza com submit_review', async () => {
    const { db, bus, job } = setup();
    const script = scripted([
      toolCall('read_file', { path: 'src/a.ts' }),
      toolCall('add_finding', { path: 'src/a.ts', line: 44, severity: 'critical', title: 'Bug', body: 'corpo' }),
      toolCall('submit_review', { summary: 'Review técnico da PR com um achado crítico.' }),
    ]);
    const result = await runAgentLoop({ ...baseDeps(db, job, { bus }), chatImpl: script.chatImpl });

    expect(result.status).toBe('succeeded');
    expect(result.summary).toContain('Review técnico');
    expect(result.turns).toBe(3);
    expect(result.usage).toEqual({ input: 30, output: 15 });
    expect(result.githubCalls).toBe(1);
    expect(db.select().from(jobs).get()!.summaryMd).toContain('Review técnico');
    const findings = listFindings(db, job.id);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.status).toBe('valid');

    const rows = db.select().from(agentMessages).all();
    expect(rows.map((row) => row.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ]);
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(rows[0]!.contentJson).toContain('revisor sênior');
    expect(rows[3]!.toolName).toBe('read_file');
    expect(rows[7]!.toolName).toBe('submit_review');
    expect(script.inputs[0]!.maxOutputTokens).toBe(1234);
    expect(script.inputs[0]!.temperature).toBe(0.2);
  });

  it('usa o adaptador do provedor e envia maxOutputTokens do perfil quando não há chatImpl', async () => {
    const { db, bus, job } = setup();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 's1',
                  type: 'function',
                  function: {
                    name: 'submit_review',
                    arguments: JSON.stringify({ summary: 'Resumo do adaptador com sucesso.' }),
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      }),
    );
    const result = await runAgentLoop({
      ...baseDeps(db, job, { bus, fetchImpl: fetchImpl as unknown as typeof fetch }),
    });

    expect(result.status).toBe('succeeded');
    expect(result.usage).toEqual({ input: 7, output: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const body = JSON.parse(String(calls[0]![1].body)) as Record<string, unknown>;
    expect(body.max_tokens).toBe(1234);
    expect(body.temperature).toBe(0.2);
  });

  it('redige segredos no resumo e persiste a nota no job', async () => {
    const { db, bus, job } = setup();
    const script = scripted([toolCall('submit_review', { summary: `Resumo técnico com token ${TOKEN} exposto.` })]);
    const result = await runAgentLoop({ ...baseDeps(db, job, { bus }), chatImpl: script.chatImpl });

    const summary = db.select().from(jobs).get()!.summaryMd!;
    expect(summary).toContain('[REDACTED]');
    expect(summary).toContain(SECRET_REDACTION_NOTE);
    expect(summary).not.toContain(TOKEN);
    expect(result.summary).toBe(summary);
  });

  it('devolve erro de resumo inválido ao modelo e aceita a próxima submissão', async () => {
    const { db, bus, job } = setup();
    const script = scripted([
      toolCall('submit_review', { summary: 'curto' }),
      toolCall('submit_review', { summary: 'Resumo válido após a correção.' }),
    ]);
    const result = await runAgentLoop({ ...baseDeps(db, job, { bus }), chatImpl: script.chatImpl });

    expect(result.status).toBe('succeeded');
    expect(result.summary).toContain('Resumo válido');
    expect(result.turns).toBe(2);
    const toolRows = db
      .select()
      .from(agentMessages)
      .all()
      .filter((row) => row.role === 'tool');
    expect(toolRows).toHaveLength(2);
    expect(toolRows[0]!.toolName).toBe('submit_review');
    expect(toolRows[0]!.contentJson).toContain('Erro:');
    expect(db.select().from(jobs).get()!.summaryMd).toContain('Resumo válido');
  });

  it('força fechamento ao atingir maxTurns e conta achados no resumo determinístico', async () => {
    const { db, bus, job } = setup();
    const script = scripted([
      toolCall('add_finding', { path: 'src/a.ts', line: 44, severity: 'critical', title: 'Bug', body: 'corpo' }),
      toolCall('list_tree', {}),
      emptyResult(),
    ]);
    const result = await runAgentLoop({
      ...baseDeps(db, job, { bus, profileSnapshot: snapshot({ maxTurns: 2 }) }),
      chatImpl: script.chatImpl,
    });

    expect(result.status).toBe('partial');
    expect(result.summary).toBe('Review parcial: limites atingidos; 1 achado.');
    expect(result.turns).toBe(2);
    expect(db.select().from(jobs).get()!.summaryMd).toBe(result.summary);
    expect(script.inputs).toHaveLength(3);
    expect(script.inputs[2]!.tools.map((tool) => tool.name)).toEqual(['submit_review']);
    expect(script.inputs[2]!.toolChoice).toEqual({ name: 'submit_review' });
  });

  it('usa resumo determinístico sem achados quando o fechamento forçado não submete', async () => {
    const { db, bus, job } = setup();
    const script = scripted([toolCall('list_tree', {}), emptyResult()]);
    const result = await runAgentLoop({
      ...baseDeps(db, job, { bus, profileSnapshot: snapshot({ maxTurns: 1 }) }),
      chatImpl: script.chatImpl,
    });

    expect(result.status).toBe('partial');
    expect(result.summary).toBe('Review parcial: limites atingidos; nenhum problema relevante encontrado.');
    expect(result.summary).not.toContain('GitHub');
    expect(db.select().from(jobs).get()!.summaryMd).toBe(result.summary);
  });

  it('força fechamento ao exceder maxTotalTokens', async () => {
    const { db, bus, job } = setup();
    const script = scripted([toolCall('list_tree', {}, { input: 10, output: 5 }), emptyResult()]);
    const result = await runAgentLoop({
      ...baseDeps(db, job, { bus, profileSnapshot: snapshot({ maxTotalTokens: 10 }) }),
      chatImpl: script.chatImpl,
    });

    expect(result.status).toBe('partial');
    expect(result.turns).toBe(1);
    expect(result.summary).toContain('limites atingidos');
    expect(script.inputs).toHaveLength(2);
    expect(script.inputs[1]!.toolChoice).toEqual({ name: 'submit_review' });
  });

  it('força fechamento ao exceder maxDurationSec', async () => {
    const { db, bus, job } = setup();
    let clock = 10_000;
    const script = scripted([
      toolCall('list_tree', {}),
      toolCall('submit_review', { summary: 'Resumo forçado após estourar a duração.' }),
    ]);
    const result = await runAgentLoop({
      ...baseDeps(db, job, { bus, profileSnapshot: snapshot({ maxDurationSec: 1 }), now: () => clock }),
      chatImpl: async (input) => {
        const next = await script.chatImpl(input);
        clock += 1_500;
        return next;
      },
    });

    expect(result.status).toBe('partial');
    expect(result.turns).toBe(1);
    expect(result.summary).toBe('Resumo forçado após estourar a duração.');
    expect(script.inputs).toHaveLength(2);
    expect(script.inputs[1]!.tools.map((tool) => tool.name)).toEqual(['submit_review']);
    expect(script.inputs[1]!.toolChoice).toEqual({ name: 'submit_review' });
  });

  it('propaga GitHubError retentável em vez de virar mensagem de ferramenta', async () => {
    const { db, bus, job } = setup();
    const fetchImpl = (async () => new Response('indisponível', { status: 500 })) as unknown as typeof fetch;
    const script = scripted([toolCall('read_file', { path: 'src/a.ts' })]);
    await expect(
      runAgentLoop({
        ...baseDeps(db, job, { bus, fetchImpl, tools: toolContext(db, job, { fetchImpl }) }),
        chatImpl: script.chatImpl,
      }),
    ).rejects.toBeInstanceOf(GitHubError);

    const rows = db.select().from(agentMessages).all();
    expect(rows.some((row) => row.role === 'tool')).toBe(false);
  });

  it('fecha com resumo submetido e marca parcial ao atingir limites', async () => {
    const { db, bus, job } = setup();
    const script = scripted([
      toolCall('list_tree', {}),
      toolCall('list_tree', {}),
      toolCall('submit_review', { summary: 'Resumo parcial com achados coletados.' }),
    ]);
    const result = await runAgentLoop({
      ...baseDeps(db, job, { bus, profileSnapshot: snapshot({ maxTurns: 2 }) }),
      chatImpl: script.chatImpl,
    });

    expect(result.status).toBe('partial');
    expect(result.summary).toContain('Resumo parcial');
    expect(db.select().from(jobs).get()!.summaryMd).toContain('Resumo parcial');
    expect(script.inputs[2]!.tools.map((tool) => tool.name)).toEqual(['submit_review']);
    expect(script.inputs[2]!.toolChoice).toEqual({ name: 'submit_review' });
  });

  it('continua o seq das mensagens ao reexecutar o mesmo job', async () => {
    const { db, bus, job } = setup();
    const firstRun = scripted([toolCall('submit_review', { summary: 'Primeira execução do mesmo job com resumo.' })]);
    await runAgentLoop({ ...baseDeps(db, job, { bus }), chatImpl: firstRun.chatImpl });
    const firstRows = db.select().from(agentMessages).orderBy(agentMessages.seq).all();
    const firstMax = firstRows[firstRows.length - 1]!.seq;

    const secondRun = scripted([toolCall('submit_review', { summary: 'Segunda execução do mesmo job com resumo.' })]);
    await runAgentLoop({ ...baseDeps(db, job, { bus }), chatImpl: secondRun.chatImpl });
    const allRows = db.select().from(agentMessages).orderBy(agentMessages.seq).all();
    const secondRows = allRows.slice(firstRows.length);

    expect(secondRows).toHaveLength(4);
    expect(secondRows[0]!.seq).toBeGreaterThan(firstMax);
    for (let index = 1; index < allRows.length; index += 1) {
      expect(allRows[index]!.seq).toBeGreaterThan(allRows[index - 1]!.seq);
    }
  });
});
