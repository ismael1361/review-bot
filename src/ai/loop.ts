import { eq, max } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { agentMessages, events, jobs } from '../db/schema';
import type { EventBus } from '../events/bus';
import { listFindings } from '../jobs/findings';
import { CancelledError } from '../jobs/worker';
import { getAdapter } from './adapters';
import type { ChatInput, ChatMessage, ChatResult, ProviderKind } from './adapters/types';
import { buildSystemPrompt, type ProfileSnapshot } from './prompt';
import { executeTool, ToolError, toolSpecs, type ToolContext } from './tools';

export type LoopDeps = {
  db: Db;
  bus: EventBus;
  job: typeof jobs.$inferSelect;
  profileSnapshot: ProfileSnapshot & { provider: ProviderKind };
  baseUrl: string;
  apiKey: string;
  skills: { name: string; contentMd: string }[];
  tools: ToolContext;
  userPrompt: string;
  chatImpl?: (input: ChatInput) => Promise<ChatResult>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  shouldCancel?: () => boolean;
};

export type LoopResult = {
  status: 'succeeded' | 'partial';
  summary: string;
  turns: number;
  usage: { input: number; output: number };
  githubCalls: number;
};

export async function runAgentLoop(deps: LoopDeps): Promise<LoopResult> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const snapshot = deps.profileSnapshot;
  const chat = deps.chatImpl ?? ((input: ChatInput) => getAdapter(snapshot.provider).chat(input, deps.fetchImpl));
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(snapshot, deps.skills) },
    { role: 'user', content: deps.userPrompt },
  ];
  const previousSeq = deps.db
    .select({ maxSeq: max(agentMessages.seq) })
    .from(agentMessages)
    .where(eq(agentMessages.jobId, deps.job.id))
    .get()?.maxSeq;
  let seq = previousSeq === null || previousSeq === undefined ? 0 : previousSeq + 1;
  let usage = { input: 0, output: 0 };
  let turns = 0;

  const persist = (message: ChatMessage, toolName?: string): void => {
    deps.db
      .insert(agentMessages)
      .values({
        id: uuidv7(),
        jobId: deps.job.id,
        seq: seq++,
        role: message.role,
        contentJson: JSON.stringify(message),
        toolName: toolName ?? null,
        tokensIn: null,
        tokensOut: null,
        createdAt: now(),
      })
      .run();
  };
  for (const message of messages) {
    persist(message);
  }

  const baseInput = (extra: Partial<ChatInput>): ChatInput => ({
    baseUrl: deps.baseUrl,
    apiKey: deps.apiKey,
    model: snapshot.model,
    temperature: snapshot.temperature,
    maxOutputTokens: snapshot.maxOutputTokens,
    messages,
    tools: toolSpecs,
    toolChoice: 'auto',
    ...extra,
  });

  const readSummary = (): string | undefined =>
    deps.db.select({ summaryMd: jobs.summaryMd }).from(jobs).where(eq(jobs.id, deps.job.id)).get()?.summaryMd ?? undefined;

  const partialSummary = (): string => {
    const findingCount = listFindings(deps.db, deps.job.id).length;
    if (findingCount === 0) {
      return 'Review parcial: limites atingidos; nenhum problema relevante encontrado.';
    }
    return `Review parcial: limites atingidos; ${findingCount} ${findingCount === 1 ? 'achado' : 'achados'}.`;
  };

  const finishForced = async (): Promise<LoopResult> => {
    const result = await chat(
      baseInput({
        tools: toolSpecs.filter((tool) => tool.name === 'submit_review'),
        toolChoice: { name: 'submit_review' },
      }),
    );
    usage = { input: usage.input + result.usage.input, output: usage.output + result.usage.output };
    const submit = result.toolCalls.find((call) => call.name === 'submit_review');
    let submitted = false;
    if (submit) {
      try {
        await executeTool('submit_review', submit.argumentsJson, deps.tools);
        submitted = true;
      } catch (error) {
        if (!(error instanceof ToolError)) {
          throw error;
        }
      }
    }
    if (submitted) {
      const summary = readSummary();
      if (summary !== undefined) {
        return { status: 'partial', summary, turns, usage, githubCalls: deps.tools.calls.count };
      }
    }
    const summary = partialSummary();
    deps.db.update(jobs).set({ summaryMd: summary }).where(eq(jobs.id, deps.job.id)).run();
    return { status: 'partial', summary, turns, usage, githubCalls: deps.tools.calls.count };
  };

  while (turns < snapshot.maxTurns) {
    if (deps.shouldCancel?.()) {
      throw new CancelledError('job_cancelled');
    }
    if (now() - startedAt > snapshot.maxDurationSec * 1000 || usage.input + usage.output > snapshot.maxTotalTokens) {
      return finishForced();
    }
    turns += 1;
    const result = await chat(baseInput({}));
    usage = { input: usage.input + result.usage.input, output: usage.output + result.usage.output };
    const assistant: ChatMessage = { role: 'assistant', content: result.content, toolCalls: result.toolCalls };
    messages.push(assistant);
    persist(assistant);
    if (result.toolCalls.length === 0) {
      const nudge: ChatMessage = {
        role: 'user',
        content: 'Continue a análise usando as ferramentas e encerre com submit_review.',
      };
      messages.push(nudge);
      persist(nudge);
      continue;
    }
    for (const call of result.toolCalls) {
      if (call.name === 'submit_review') {
        try {
          const outcome = await executeTool(call.name, call.argumentsJson, deps.tools);
          const toolMessage: ChatMessage = {
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: outcome.content,
          };
          messages.push(toolMessage);
          persist(toolMessage, call.name);
          const summary = readSummary();
          if (summary !== undefined) {
            return { status: 'succeeded', summary, turns, usage, githubCalls: deps.tools.calls.count };
          }
          const fallback = partialSummary();
          deps.db.update(jobs).set({ summaryMd: fallback }).where(eq(jobs.id, deps.job.id)).run();
          return { status: 'partial', summary: fallback, turns, usage, githubCalls: deps.tools.calls.count };
        } catch (error) {
          if (!(error instanceof ToolError)) {
            throw error;
          }
          const toolMessage: ChatMessage = {
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: `Erro: ${error.message}`,
          };
          messages.push(toolMessage);
          persist(toolMessage, call.name);
          continue;
        }
      }
      let content: string;
      try {
        content = (await executeTool(call.name, call.argumentsJson, deps.tools)).content;
      } catch (error) {
        if (!(error instanceof ToolError)) {
          throw error;
        }
        content = `Erro: ${error.message}`;
      }
      const toolMessage: ChatMessage = { role: 'tool', toolCallId: call.id, name: call.name, content };
      messages.push(toolMessage);
      persist(toolMessage, call.name);
      deps.db
        .insert(events)
        .values({
          id: uuidv7(),
          jobId: deps.job.id,
          level: 'info',
          type: 'job.progress',
          message: `Ferramenta: ${call.name}`,
          dataJson: null,
          createdAt: now(),
        })
        .run();
      deps.bus.publish({ type: 'job.progress', data: { jobId: deps.job.id, tool: call.name }, at: now() });
    }
  }
  return finishForced();
}
