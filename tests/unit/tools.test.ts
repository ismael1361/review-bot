import { describe, expect, it, vi } from 'vitest';
import { executeTool, ToolError, type PrFileEntry, type ToolContext } from '../../src/ai/tools';
import { jobs, repositories, reviewFindings } from '../../src/db/schema';
import { GitHubError } from '../../src/github/client';
import { parseFilePatch } from '../../src/github/diff';
import { SECRET_REDACTION_NOTE } from '../../src/jobs/findings';
import { createTestDb } from '../helpers/db';

const TOKEN = `ghp_${'a'.repeat(36)}`;

const defaultPatch = [
  '@@ -40,6 +40,7 @@',
  '   const row = x;',
  '   if (!row) {',
  '     return;',
  '   }',
  '+  const now = Date.now();',
  '   const user = y;',
  '   return user;',
].join('\n');

const secretPatch = [
  '@@ -40,6 +40,7 @@',
  '   const row = x;',
  '   if (!row) {',
  '     return;',
  '   }',
  `+  const token = '${TOKEN}';`,
  '   const user = y;',
  '   return user;',
].join('\n');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fileEntry(path: string, patch = defaultPatch): PrFileEntry {
  return { path, status: 'modified', additions: 1, deletions: 0, patch, hunks: parseFilePatch(patch) };
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
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
  return {
    db,
    job: db.select().from(jobs).get()!,
    token: 't',
    baseRepo: { owner: 'a', name: 'b' },
    headRepoFullName: 'a/b',
    headSha: 's',
    prNumber: 1,
    files: [fileEntry('src/a.ts')],
    validLines: new Map([['src/a.ts', new Set([44])]]),
    calls: { count: 0, max: 80 },
    searchCalls: { count: 0, max: 5 },
    maxFindings: 25,
    ...overrides,
  };
}

describe('tools', () => {
  it('read_file decodifica, numera linhas e preserva barras na URL', async () => {
    let requested = '';
    const fetchImpl = vi.fn(async (url: string) => {
      requested = String(url);
      return jsonResponse({
        content: Buffer.from('linha1\nlinha2\nlinha3').toString('base64'),
        encoding: 'base64',
      });
    }) as unknown as typeof fetch;
    const ctx = context({ fetchImpl });
    const result = await executeTool('read_file', JSON.stringify({ path: 'src/a.ts', start: 2, end: 3 }), ctx);
    expect(result.content).toBe('2: linha2\n3: linha3');
    expect(requested).toContain('/repos/a/b/contents/src/a.ts?ref=s');
    expect(requested).not.toContain('src%2Fa.ts');
    expect(ctx.calls.count).toBe(1);
  });

  it('read_file rejeita caminhos absolutos e traversal sem consumir orçamento', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ content: '', encoding: 'base64' })) as unknown as typeof fetch;
    const ctx = context({ fetchImpl });
    for (const path of ['../secret', '/etc/passwd', 'src/../x', 'src//x', 'C:/x']) {
      await expect(executeTool('read_file', JSON.stringify({ path }), ctx)).rejects.toBeInstanceOf(ToolError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ctx.calls.count).toBe(0);
  });

  it('read_file rejeita faixa invertida sem chamar o GitHub', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ content: '', encoding: 'base64' })) as unknown as typeof fetch;
    const ctx = context({ fetchImpl });
    await expect(
      executeTool('read_file', JSON.stringify({ path: 'src/a.ts', start: 5, end: 3 }), ctx),
    ).rejects.toBeInstanceOf(ToolError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(ctx.calls.count).toBe(0);
  });

  it('read_file aplica a faixa antes do limite de 200 KB', async () => {
    const line = 'x'.repeat(120);
    const content = Array.from({ length: 3_000 }, () => line).join('\n');
    expect(Buffer.byteLength(content, 'utf8')).toBeGreaterThan(200_000);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ content: Buffer.from(content).toString('base64'), encoding: 'base64' }),
    ) as unknown as typeof fetch;
    const result = await executeTool(
      'read_file',
      JSON.stringify({ path: 'src/grande.ts', start: 2_500, end: 2_500 }),
      context({ fetchImpl }),
    );
    expect(result.content).toBe(`2500: ${line}`);
    expect(result.content).not.toContain('…(truncado)');
  });

  it('read_file rejeita resposta de diretório', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([{ name: 'a.ts', type: 'file', path: 'src/a.ts' }]),
    ) as unknown as typeof fetch;
    await expect(
      executeTool('read_file', JSON.stringify({ path: 'src' }), context({ fetchImpl })),
    ).rejects.toThrow('O caminho não é um arquivo ou o conteúdo não está disponível');
  });

  it('list_directory rejeita resposta de arquivo', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ name: 'a.ts', type: 'file', path: 'src/a.ts' }),
    ) as unknown as typeof fetch;
    await expect(
      executeTool('list_directory', JSON.stringify({ path: 'src/a.ts' }), context({ fetchImpl })),
    ).rejects.toThrow('O caminho é um arquivo; use read_file');
  });

  it('list_tree limita a 5.000 entradas e sinaliza truncamento', async () => {
    const tree = Array.from({ length: 5_001 }, (_, index) => ({ path: `src/f${index}.ts`, type: 'blob' }));
    const fetchImpl = vi.fn(async () => jsonResponse({ tree })) as unknown as typeof fetch;
    const result = await executeTool('list_tree', '{}', context({ fetchImpl }));
    expect(result.content.split('\n').filter((line) => line.startsWith('file '))).toHaveLength(5_000);
    expect(result.content).toContain('src/f4999.ts');
    expect(result.content).not.toContain('src/f5000.ts');
    expect(result.content).toContain('…(truncado)');
  });

  it('list_directory limita a 200 entradas e sinaliza truncamento', async () => {
    const entries = Array.from({ length: 201 }, (_, index) => ({
      name: `f${index}.ts`,
      type: 'file',
      path: `src/f${index}.ts`,
    }));
    const fetchImpl = vi.fn(async () => jsonResponse(entries)) as unknown as typeof fetch;
    const result = await executeTool('list_directory', JSON.stringify({ path: 'src' }), context({ fetchImpl }));
    expect(result.content).toContain('src/f199.ts');
    expect(result.content).not.toContain('src/f200.ts');
    expect(result.content).toContain('…(truncado)');
    expect(result.content.split('\n').filter((line) => line.startsWith('file '))).toHaveLength(200);
  });

  it('search_code usa o repositório base', async () => {
    let requested = '';
    const fetchImpl = vi.fn(async (url: string) => {
      requested = String(url);
      return jsonResponse({ items: [{ path: 'src/x.ts' }] });
    }) as unknown as typeof fetch;
    const ctx = context({
      fetchImpl,
      baseRepo: { owner: 'upstream', name: 'base' },
      headRepoFullName: 'fork/head',
    });
    const result = await executeTool('search_code', JSON.stringify({ query: 'resolveSession' }), ctx);
    expect(result.content).toBe('src/x.ts');
    expect(requested).toContain('repo%3Aupstream%2Fbase');
    expect(requested).not.toContain('repo%3Afork%2Fhead');
    expect(ctx.searchCalls.count).toBe(1);
    expect(ctx.calls.count).toBe(1);
  });

  it('search_code limita a 5 buscas e rejeita a sexta', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [] })) as unknown as typeof fetch;
    const ctx = context({ fetchImpl });
    for (let index = 0; index < 5; index += 1) {
      await executeTool('search_code', JSON.stringify({ query: `consulta${index}` }), ctx);
    }
    await expect(
      executeTool('search_code', JSON.stringify({ query: 'sexta' }), ctx),
    ).rejects.toThrow('Limite de buscas de código atingido');
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(ctx.searchCalls.count).toBe(5);
  });

  it('search_code conta tentativa que falha no orçamento de buscas', async () => {
    const fetchImpl = vi.fn(async () => new Response('não encontrado', { status: 404 })) as unknown as typeof fetch;
    const ctx = context({ fetchImpl });
    await expect(
      executeTool('search_code', JSON.stringify({ query: 'consulta' }), ctx),
    ).rejects.toBeInstanceOf(ToolError);
    expect(ctx.searchCalls.count).toBe(1);
  });

  it('get_existing_comments consome duas unidades de orçamento', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('/reviews')
        ? jsonResponse([{ body: 'review antiga', user: { login: 'bot' } }])
        : jsonResponse([{ body: 'comentário antigo', path: 'src/a.ts', line: 44, user: { login: 'bot' } }]),
    ) as unknown as typeof fetch;
    const ctx = context({ fetchImpl, calls: { count: 0, max: 2 } });
    const result = await executeTool('get_existing_comments', '{}', ctx);
    expect(result.content).toContain('review antiga');
    expect(result.content).toContain('comentário antigo');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(ctx.calls.count).toBe(2);
  });

  it('get_existing_comments falha quando só resta uma unidade de orçamento', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([])) as unknown as typeof fetch;
    const ctx = context({ fetchImpl, calls: { count: 1, max: 2 } });
    await expect(executeTool('get_existing_comments', '{}', ctx)).rejects.toBeInstanceOf(ToolError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(ctx.calls.count).toBe(2);
  });

  it('respeita o orçamento esgotado', async () => {
    const ctx = context({ calls: { count: 80, max: 80 } });
    await expect(executeTool('list_tree', '{}', ctx)).rejects.toBeInstanceOf(ToolError);
  });

  it('add_finding aceita linha válida do arquivo e redige o snippet', async () => {
    const ctx = context({
      files: [fileEntry('src/a.ts', secretPatch)],
      validLines: new Map([['src/a.ts', new Set([44])]]),
    });
    const result = await executeTool(
      'add_finding',
      JSON.stringify({ path: 'src/a.ts', line: 44, severity: 'critical', title: 'Token exposto', body: 'corpo' }),
      ctx,
    );
    expect(result.content).toContain('inline');
    const row = ctx.db.select().from(reviewFindings).get()!;
    expect(row.status).toBe('valid');
    expect(row.startLine).toBe(44);
    expect(row.endLine).toBe(44);
    expect(row.bodyMd).toContain(SECRET_REDACTION_NOTE);
    expect(row.bodyMd).not.toContain(TOKEN);
    const snippet = JSON.parse(row.snippetJson!) as { lines: { text: string }[]; targetLine: number };
    expect(snippet.targetLine).toBe(44);
    expect(snippet.lines.some((line) => line.text.includes('[REDACTED]'))).toBe(true);
    expect(snippet.lines.some((line) => line.text.includes(TOKEN))).toBe(false);
  });

  it('add_finding valida a linha no arquivo correto', async () => {
    const ctx = context({
      files: [fileEntry('src/a.ts'), fileEntry('src/b.ts')],
      validLines: new Map([['src/b.ts', new Set([44])]]),
    });
    const result = await executeTool(
      'add_finding',
      JSON.stringify({ path: 'src/a.ts', line: 44, severity: 'critical', title: 'Fora', body: 'corpo' }),
      ctx,
    );
    expect(result.content).toContain('fora do diff');
    expect(ctx.db.select().from(reviewFindings).get()!.status).toBe('outside_diff');
  });

  it('add_finding rejeita arquivo fora da PR e linha fora do diff com aviso', async () => {
    const ctx = context();
    await expect(
      executeTool(
        'add_finding',
        JSON.stringify({ path: 'src/c.ts', line: 1, severity: 'medium', title: 'Arquivo', body: 'corpo' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ToolError);
    const result = await executeTool(
      'add_finding',
      JSON.stringify({ path: 'src/a.ts', line: 999, severity: 'medium', title: 'Linha', body: 'corpo' }),
      ctx,
    );
    expect(result.content).toContain('fora do diff');
  });

  it('add_general_finding respeita o limite de 10', async () => {
    const ctx = context();
    for (let index = 0; index < 10; index += 1) {
      await executeTool(
        'add_general_finding',
        JSON.stringify({ severity: 'medium', title: `Geral ${index}`, body: 'corpo' }),
        ctx,
      );
    }
    await expect(
      executeTool(
        'add_general_finding',
        JSON.stringify({ severity: 'medium', title: 'Geral excedente', body: 'corpo' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(ToolError);
    expect(ctx.db.select().from(reviewFindings).all()).toHaveLength(10);
  });

  it('submit_review redige e persiste o resumo no job', async () => {
    const ctx = context();
    await executeTool('submit_review', JSON.stringify({ summary: `Resumo técnico com ${TOKEN} e achados.` }), ctx);
    const summary = ctx.db.select().from(jobs).get()!.summaryMd!;
    expect(summary).toContain('[REDACTED]');
    expect(summary).toContain(SECRET_REDACTION_NOTE);
    expect(summary).not.toContain(TOKEN);
  });

  it('converte GitHubError não retentável em ToolError', async () => {
    const fetchImpl = vi.fn(async () => new Response('não encontrado', { status: 404 })) as unknown as typeof fetch;
    await expect(
      executeTool('read_file', JSON.stringify({ path: 'src/a.ts' }), context({ fetchImpl })),
    ).rejects.toBeInstanceOf(ToolError);
  });

  it('propaga GitHubError retentável para nova tentativa do job', async () => {
    const fetchImpl = vi.fn(async () => new Response('indisponível', { status: 500 })) as unknown as typeof fetch;
    await expect(
      executeTool('read_file', JSON.stringify({ path: 'src/a.ts' }), context({ fetchImpl })),
    ).rejects.toBeInstanceOf(GitHubError);
  });

  it('rejeita JSON inválido e ferramenta desconhecida', async () => {
    const ctx = context();
    await expect(executeTool('read_file', '{', ctx)).rejects.toBeInstanceOf(ToolError);
    await expect(executeTool('ferramenta_inexistente', '{}', ctx)).rejects.toBeInstanceOf(ToolError);
  });
});
