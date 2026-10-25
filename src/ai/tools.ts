import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client';
import { jobs } from '../db/schema';
import { GitHubError, githubJson } from '../github/client';
import { renderDiffSnippet, type DiffHunk } from '../github/diff';
import { addFinding, addGeneralFinding, FindingError, SECRET_REDACTION_NOTE } from '../jobs/findings';
import type { JobRow } from '../jobs/queue';
import { redactSecrets } from '../shared/redact';
import type { ToolSpec } from './adapters/types';

export class ToolError extends Error {}

export type PrFileEntry = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  hunks: DiffHunk[];
};

export type ToolContext = {
  db: Db;
  job: JobRow;
  token: string;
  fetchImpl?: typeof fetch;
  baseRepo: { owner: string; name: string };
  headRepoFullName: string;
  headSha: string;
  prNumber: number;
  files: PrFileEntry[];
  validLines: Map<string, Set<number>>;
  calls: { count: number; max: number };
  searchCalls: { count: number; max: number };
  maxFindings: number;
};

const FindArgs = z.object({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  severity: z.enum(['critical', 'medium', 'suggestion', 'strength']),
  title: z.string().min(3).max(200),
  body: z.string().min(1).max(8000),
  suggestion: z.string().max(4000).optional(),
});

const GeneralArgs = FindArgs.omit({ path: true, line: true, endLine: true });

const ReadFileArgs = z.object({
  path: z.string().min(1),
  start: z.number().int().positive().optional(),
  end: z.number().int().positive().optional(),
});

const DirectoryArgs = z.object({
  path: z.string().min(1),
});

const SearchArgs = z.object({
  query: z.string().min(2),
});

const SummaryArgs = z.object({
  summary: z.string().min(10).max(20_000),
});

export const toolSpecs: ToolSpec[] = [
  {
    name: 'get_pr_files',
    description: 'Lista os arquivos alterados da PR com patches.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'read_file',
    description: 'Lê um arquivo no SHA da PR, com faixa opcional de linhas.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        start: { type: 'number' },
        end: { type: 'number' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'Lista um diretório no SHA da PR.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'list_tree',
    description: 'Lista a árvore do repositório no SHA da PR.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'search_code',
    description: 'Busca código no repositório da PR.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_commits',
    description: 'Lista os commits da PR.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_existing_comments',
    description: 'Lista reviews e comentários já existentes na PR.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'add_finding',
    description: 'Registra um achado ancorado a uma linha do diff.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        line: { type: 'number' },
        endLine: { type: 'number' },
        severity: { type: 'string', enum: ['critical', 'medium', 'suggestion', 'strength'] },
        title: { type: 'string' },
        body: { type: 'string' },
        suggestion: { type: 'string' },
      },
      required: ['path', 'severity', 'title', 'body'],
    },
  },
  {
    name: 'add_general_finding',
    description: 'Registra um achado sem linha no diff (vai no corpo do review).',
    parameters: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['critical', 'medium', 'suggestion', 'strength'] },
        title: { type: 'string' },
        body: { type: 'string' },
        suggestion: { type: 'string' },
      },
      required: ['severity', 'title', 'body'],
    },
  },
  {
    name: 'submit_review',
    description: 'Encerra a análise com o resumo do review em Markdown.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  },
];

const MAX_BYTES = 200_000;
const MAX_TREE_ENTRIES = 5_000;
const MAX_DIRECTORY_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 30;

function budget(ctx: ToolContext): void {
  if (ctx.calls.count >= ctx.calls.max) {
    throw new ToolError('Orçamento de chamadas ao GitHub esgotado; finalize com submit_review');
  }
  ctx.calls.count += 1;
}

function encodeRepoPath(path: string): string {
  if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(path)) {
    throw new ToolError('Caminhos absolutos não são permitidos');
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new ToolError('Caminho inválido');
  }
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

function decodeBase64(content: string): string {
  return Buffer.from(content, 'base64').toString('utf8');
}

function capOutput(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_BYTES) {
    return text;
  }
  const buffer = Buffer.from(text, 'utf8');
  return `${buffer.subarray(0, MAX_BYTES).toString('utf8')}\n…(truncado)`;
}

function parseArgs<T extends z.ZodTypeAny>(schema: T, argsJson: string): z.infer<T> {
  try {
    return schema.parse(JSON.parse(argsJson));
  } catch {
    throw new ToolError('Argumentos inválidos');
  }
}

async function githubRequest<T>(ctx: ToolContext, path: string): Promise<T> {
  budget(ctx);
  try {
    return (await githubJson<T>(path, { token: ctx.token, fetchImpl: ctx.fetchImpl })).data;
  } catch (error) {
    if (error instanceof GitHubError && !error.retryable) {
      throw new ToolError(`Falha na API do GitHub: ${error.message}`);
    }
    throw error;
  }
}

export async function executeTool(name: string, argsJson: string, ctx: ToolContext): Promise<{ content: string }> {
  const head = ctx.headRepoFullName;

  if (name === 'get_pr_files') {
    const listing = ctx.files
      .map(
        (file) =>
          `${file.status} ${file.path} (+${file.additions}/-${file.deletions})${file.patch ? `\n${file.patch.slice(0, 4000)}` : '\n(patch indisponível)'}`,
      )
      .join('\n\n');
    return { content: listing.slice(0, 100_000) || 'Nenhum arquivo' };
  }

  if (name === 'read_file') {
    const args = parseArgs(ReadFileArgs, argsJson);
    if (args.start !== undefined && args.end !== undefined && args.end < args.start) {
      throw new ToolError('Intervalo de linhas inválido');
    }
    const encodedPath = encodeRepoPath(args.path);
    const data = await githubRequest<unknown>(ctx, `/repos/${head}/contents/${encodedPath}?ref=${ctx.headSha}`);
    if (
      data === null ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      typeof (data as { content?: unknown }).content !== 'string' ||
      typeof (data as { encoding?: unknown }).encoding !== 'string'
    ) {
      throw new ToolError('O caminho não é um arquivo ou o conteúdo não está disponível');
    }
    const file = data as { content: string; encoding: string };
    if (file.encoding === 'none') {
      throw new ToolError('O caminho não é um arquivo ou o conteúdo não está disponível');
    }
    const text = file.encoding === 'base64' ? decodeBase64(file.content) : file.content;
    if (args.start !== undefined || args.end !== undefined) {
      const lines = text.split('\n');
      const start = args.start ?? 1;
      const end = args.end ?? lines.length;
      const numbered = lines
        .slice(start - 1, end)
        .map((line, index) => `${start + index}: ${line}`)
        .join('\n');
      return { content: capOutput(numbered) };
    }
    return { content: capOutput(text) };
  }

  if (name === 'list_directory') {
    const args = parseArgs(DirectoryArgs, argsJson);
    const encodedPath = encodeRepoPath(args.path);
    const data = await githubRequest<unknown>(ctx, `/repos/${head}/contents/${encodedPath}?ref=${ctx.headSha}`);
    if (!Array.isArray(data)) {
      if (data !== null && typeof data === 'object') {
        throw new ToolError('O caminho é um arquivo; use read_file');
      }
      throw new ToolError('O caminho não é um diretório');
    }
    const entries = (data as { name: string; type: string; path: string }[])
      .slice(0, MAX_DIRECTORY_ENTRIES)
      .map((entry) => `${entry.type === 'dir' ? 'dir ' : 'file'} ${entry.path}`);
    const note = data.length > MAX_DIRECTORY_ENTRIES ? '\n…(truncado)' : '';
    return { content: `${entries.join('\n')}${note}` };
  }

  if (name === 'list_tree') {
    const data = await githubRequest<unknown>(ctx, `/repos/${head}/git/trees/${ctx.headSha}?recursive=1`);
    if (data === null || typeof data !== 'object' || !Array.isArray((data as { tree?: unknown }).tree)) {
      throw new ToolError('Resposta inválida do GitHub');
    }
    const tree = (data as { tree: { path: string; type: string }[] }).tree;
    const entries = tree
      .slice(0, MAX_TREE_ENTRIES)
      .map((entry) => `${entry.type === 'tree' ? 'dir ' : 'file'} ${entry.path}`);
    const note = tree.length > MAX_TREE_ENTRIES ? '\n…(truncado)' : '';
    return { content: `${entries.join('\n')}${note}` };
  }

  if (name === 'search_code') {
    const args = parseArgs(SearchArgs, argsJson);
    if (ctx.searchCalls.count >= ctx.searchCalls.max) {
      throw new ToolError('Limite de buscas de código atingido');
    }
    ctx.searchCalls.count += 1;
    const data = await githubRequest<{ items: { path: string }[] }>(
      ctx,
      `/search/code?q=${encodeURIComponent(`${args.query} repo:${ctx.baseRepo.owner}/${ctx.baseRepo.name}`)}`,
    );
    return { content: data.items.slice(0, MAX_SEARCH_RESULTS).map((item) => item.path).join('\n') || 'Sem resultados' };
  }

  if (name === 'get_commits') {
    const data = await githubRequest<{ sha: string; commit: { message: string } }[]>(
      ctx,
      `/repos/${ctx.baseRepo.owner}/${ctx.baseRepo.name}/pulls/${ctx.prNumber}/commits?per_page=100`,
    );
    return {
      content: data.map((commit) => `${commit.sha.slice(0, 7)} ${commit.commit.message.split('\n')[0]}`).join('\n'),
    };
  }

  if (name === 'get_existing_comments') {
    const reviews = await githubRequest<{ body: string | null; user: { login: string } }[]>(
      ctx,
      `/repos/${ctx.baseRepo.owner}/${ctx.baseRepo.name}/pulls/${ctx.prNumber}/reviews?per_page=100`,
    );
    const comments = await githubRequest<{ body: string; path: string; line: number | null; user: { login: string } }[]>(
      ctx,
      `/repos/${ctx.baseRepo.owner}/${ctx.baseRepo.name}/pulls/${ctx.prNumber}/comments?per_page=100`,
    );
    const reviewText = reviews
      .filter((review) => review.body)
      .slice(0, 20)
      .map((review) => `review de ${review.user.login}: ${review.body!.slice(0, 300)}`);
    const commentText = comments
      .slice(0, 50)
      .map((comment) => `${comment.path}:${comment.line ?? '?'} (${comment.user.login}) ${comment.body.slice(0, 200)}`);
    return { content: [...reviewText, ...commentText].join('\n') || 'Nenhum comentário existente' };
  }

  if (name === 'add_finding') {
    const args = parseArgs(FindArgs, argsJson);
    const file = ctx.files.find((entry) => entry.path === args.path);
    const snippet = file && args.line !== undefined ? renderDiffSnippet(file.hunks, args.line) : undefined;
    try {
      const result = addFinding(
        ctx.db,
        ctx.job.id,
        {
          path: args.path,
          line: args.line,
          endLine: args.endLine,
          severity: args.severity,
          title: args.title,
          bodyMd: args.body,
          suggestionMd: args.suggestion,
          snippet,
        },
        {
          validLines: ctx.validLines,
          filePaths: new Set(ctx.files.map((entry) => entry.path)),
          maxFindings: ctx.maxFindings,
        },
      );
      return {
        content:
          result.status === 'valid'
            ? `Achado registrado para comentário inline na linha ${args.line}.`
            : 'Achado registrado fora do diff; será publicado no corpo do review.',
      };
    } catch (error) {
      if (error instanceof FindingError) {
        throw new ToolError(error.message);
      }
      throw error;
    }
  }

  if (name === 'add_general_finding') {
    const args = parseArgs(GeneralArgs, argsJson);
    try {
      addGeneralFinding(
        ctx.db,
        ctx.job.id,
        {
          severity: args.severity,
          title: args.title,
          bodyMd: args.body,
          suggestionMd: args.suggestion,
        },
        ctx.maxFindings,
      );
      return { content: 'Achado geral registrado; será publicado no corpo do review.' };
    } catch (error) {
      if (error instanceof FindingError) {
        throw new ToolError(error.message);
      }
      throw error;
    }
  }

  if (name === 'submit_review') {
    const args = parseArgs(SummaryArgs, argsJson);
    const summary = redactSecrets(args.summary);
    const summaryMd = summary.text + (summary.redacted ? SECRET_REDACTION_NOTE : '');
    ctx.db.update(jobs).set({ summaryMd }).where(eq(jobs.id, ctx.job.id)).run();
    return { content: 'ok' };
  }

  throw new ToolError(`Ferramenta desconhecida: ${name}`);
}
