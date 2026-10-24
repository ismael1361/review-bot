import { describe, expect, it } from 'vitest';
import { parseFilePatch, renderDiffSnippet, targetHunk, validRightLines } from '../../src/github/diff';

const patch = [
  '@@ -40,6 +40,7 @@ export function resolveSession(db: Db, token: string) {',
  '   const row = db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(token))).get();',
  '   if (!row) {',
  '     return undefined;',
  '   }',
  '+  const now = Date.now();',
  '   const user = db.select().from(users).where(eq(users.id, row.userId)).get();',
  '   if (!user || user.disabled) {',
  '@@ -88,3 +89,3 @@ async function fetchPr() {',
  '-  const response = await fetch(url);',
  '+  const response = await withRetry(() => fetch(url));',
  '   return response;',
].join('\n');

describe('diff', () => {
  it('parseia hunks e linhas', () => {
    const hunks = parseFilePatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]!.lines.find((line) => line.type === 'add')?.newLine).toBe(44);
    expect(hunks[0]!.lines.find((line) => line.type === 'context')?.oldLine).toBe(40);
  });

  it('calcula linhas válidas do lado RIGHT', () => {
    const lines = validRightLines(parseFilePatch(patch));
    expect(lines.has(44)).toBe(true);
    expect(lines.has(45)).toBe(true);
    expect(lines.has(90)).toBe(true);
    expect(lines.has(999)).toBe(false);
  });

  it('recorta o trecho ao redor da linha', () => {
    const snippet = renderDiffSnippet(parseFilePatch(patch), 44, 2);
    expect(snippet?.targetLine).toBe(44);
    expect(snippet!.lines.length).toBeLessThanOrEqual(5);
    expect(snippet!.lines.some((line) => line.newLine === 44 && line.type === 'add')).toBe(true);
  });

  it('reinicia a numeração em cada hunk', () => {
    const hunks = parseFilePatch(patch);
    expect(hunks[1]!.lines[0]).toEqual({ type: 'del', oldLine: 88, newLine: null, text: '  const response = await fetch(url);' });
    expect(hunks[1]!.lines[1]).toEqual({
      type: 'add',
      oldLine: null,
      newLine: 89,
      text: '  const response = await withRetry(() => fetch(url));',
    });
  });
});

describe('parseFilePatch', () => {
  it('normaliza CRLF', () => {
    expect(parseFilePatch(patch.replace(/\n/g, '\r\n'))).toEqual(parseFilePatch(patch));
  });

  it('ignora linha vazia final', () => {
    const hunks = parseFilePatch('@@ -1,1 +1,1 @@\n a\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toEqual([{ type: 'context', oldLine: 1, newLine: 1, text: 'a' }]);
  });

  it('ignora linha vazia no meio do hunk', () => {
    const hunks = parseFilePatch('@@ -1,2 +1,2 @@\n a\n\n b\n');
    expect(hunks[0]!.lines.map((line) => line.newLine)).toEqual([1, 2]);
  });

  it('ignora marcador de fim de arquivo sem newline', () => {
    const hunks = parseFilePatch('@@ -1,2 +1,2 @@\n-old\n+new\n\\ No newline at end of file\n');
    expect(hunks[0]!.lines.map((line) => line.type)).toEqual(['del', 'add']);
  });

  it('aceita cabeçalho de hunk sem contagem', () => {
    const hunks = parseFilePatch('@@ -7 +7 @@\n antigo\n+novo\n');
    expect(hunks[0]).toMatchObject({ header: '@@ -7 +7 @@', oldStart: 7, newStart: 7 });
    expect(hunks[0]!.lines).toEqual([
      { type: 'context', oldLine: 7, newLine: 7, text: 'antigo' },
      { type: 'add', oldLine: null, newLine: 8, text: 'novo' },
    ]);
  });

  it('parseia hunk de arquivo novo', () => {
    const hunks = parseFilePatch('@@ -0,0 +1,3 @@\n+um\n+dois\n+tres\n');
    expect(hunks[0]).toMatchObject({ oldStart: 0, newStart: 1 });
    expect(hunks[0]!.lines.map((line) => line.newLine)).toEqual([1, 2, 3]);
    expect([...validRightLines(hunks)]).toEqual([1, 2, 3]);
  });

  it('parseia hunk de arquivo removido sem linhas RIGHT', () => {
    const hunks = parseFilePatch('@@ -1,2 +0,0 @@\n-um\n-dois\n');
    expect(hunks[0]).toMatchObject({ oldStart: 1, newStart: 0 });
    expect(hunks[0]!.lines).toEqual([
      { type: 'del', oldLine: 1, newLine: null, text: 'um' },
      { type: 'del', oldLine: 2, newLine: null, text: 'dois' },
    ]);
    expect(validRightLines(hunks).size).toBe(0);
  });

  it('ignora marcador desconhecido sem deslocar numeração', () => {
    const hunks = parseFilePatch('@@ -1,2 +1,2 @@\n a\n?metadado\n b\n+d\n');
    expect(hunks[0]!.lines).toEqual([
      { type: 'context', oldLine: 1, newLine: 1, text: 'a' },
      { type: 'context', oldLine: 2, newLine: 2, text: 'b' },
      { type: 'add', oldLine: null, newLine: 3, text: 'd' },
    ]);
    expect(validRightLines(hunks)).toEqual(new Set([1, 2, 3]));
  });

  it('ignora conteúdo antes do primeiro hunk', () => {
    const hunks = parseFilePatch('--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n a\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.lines).toHaveLength(1);
  });
});

describe('validRightLines', () => {
  it('inclui contexto e adições e exclui remoções', () => {
    const hunks = parseFilePatch('@@ -10,3 +10,3 @@\n contexto\n-removida\n+adicionada\n');
    expect(hunks[0]!.lines[1]).toEqual({ type: 'del', oldLine: 11, newLine: null, text: 'removida' });
    const lines = validRightLines(hunks);
    expect(lines.has(10)).toBe(true);
    expect(lines.has(11)).toBe(true);
    expect(lines.has(12)).toBe(false);
  });
});

describe('targetHunk', () => {
  it('localiza o hunk da linha', () => {
    const hunks = parseFilePatch(patch);
    expect(targetHunk(hunks, 40)).toBe(hunks[0]);
    expect(targetHunk(hunks, 46)).toBe(hunks[0]);
    expect(targetHunk(hunks, 89)).toBe(hunks[1]);
    expect(targetHunk(hunks, 999)).toBeUndefined();
    expect(targetHunk(hunks, 88)).toBeUndefined();
  });
});

describe('renderDiffSnippet', () => {
  it('limita o contexto na primeira e na última linha do hunk', () => {
    const hunks = parseFilePatch(patch);
    const first = renderDiffSnippet(hunks, 40, 3);
    expect(first?.targetLine).toBe(40);
    expect(first?.lines[0]?.newLine).toBe(40);
    const last = renderDiffSnippet(hunks, 46, 3);
    expect(last?.targetLine).toBe(46);
    expect(last?.lines.at(-1)?.newLine).toBe(46);
  });

  it('respeita contexto zero', () => {
    const snippet = renderDiffSnippet(parseFilePatch(patch), 44, 0);
    expect(snippet?.lines).toHaveLength(1);
    expect(snippet?.lines[0]).toMatchObject({ type: 'add', newLine: 44 });
  });

  it('limita contexto maior que o hunk', () => {
    const snippet = renderDiffSnippet(parseFilePatch(patch), 44, 999);
    expect(snippet?.lines).toHaveLength(7);
    expect(snippet?.lines[0]?.newLine).toBe(40);
    expect(snippet?.lines.at(-1)?.newLine).toBe(46);
  });

  it('retorna undefined fora dos hunks ou em linha removida', () => {
    const hunks = parseFilePatch(patch);
    expect(renderDiffSnippet(hunks, 999)).toBeUndefined();
    expect(renderDiffSnippet(hunks, 88)).toBeUndefined();
  });
});
