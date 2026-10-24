import { describe, expect, it } from 'vitest';
import { jobs, repositories } from '../../src/db/schema';
import type { DiffLine } from '../../src/github/diff';
import {
  addFinding,
  addGeneralFinding,
  FindingError,
  listFindings,
  MAX_GENERAL_FINDINGS,
  SECRET_REDACTION_NOTE,
  type FindingContext,
} from '../../src/jobs/findings';
import { createTestDb } from '../helpers/db';

function seed() {
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
  return db;
}

function context(overrides: Partial<FindingContext> = {}): FindingContext {
  return {
    validLines: new Map([['src/a.ts', new Set([44])]]),
    filePaths: new Set(['src/a.ts', 'src/b.ts']),
    maxFindings: 25,
    ...overrides,
  };
}

const base = {
  path: 'src/a.ts',
  severity: 'critical' as const,
  title: 'Bug crítico',
  bodyMd: 'corpo',
};

const TOKEN = `ghp_${'a'.repeat(36)}`;

describe('findings', () => {
  it('aceita linha válida como inline', () => {
    const db = seed();
    const result = addFinding(db, 'j1', { ...base, line: 44 }, context());
    expect(result.status).toBe('valid');
    expect(listFindings(db, 'j1')[0]!.status).toBe('valid');
  });

  it('valida linhas por arquivo', () => {
    const db = seed();
    const ctx = context({
      validLines: new Map([
        ['src/a.ts', new Set([44])],
        ['src/b.ts', new Set([1])],
      ]),
    });
    expect(addFinding(db, 'j1', { ...base, line: 44 }, ctx).status).toBe('valid');
    expect(addFinding(db, 'j1', { ...base, path: 'src/b.ts', title: 'Outro bug', line: 44 }, ctx).status).toBe('outside_diff');
  });

  it('move linha fora do diff para outside_diff', () => {
    const db = seed();
    const result = addFinding(db, 'j1', { ...base, line: 999 }, context());
    expect(result.status).toBe('outside_diff');
    expect(listFindings(db, 'j1')[0]!.status).toBe('outside_diff');
  });

  it('armazena início e fim para achados de uma e de várias linhas', () => {
    const db = seed();
    addFinding(db, 'j1', { ...base, line: 44 }, context());
    addFinding(db, 'j1', { ...base, title: 'Outro bug', line: 44, endLine: 50 }, context());
    const rows = listFindings(db, 'j1');
    expect(rows.find((row) => row.title === 'Bug crítico')).toMatchObject({ startLine: 44, endLine: 44 });
    expect(rows.find((row) => row.title === 'Outro bug')).toMatchObject({ startLine: 44, endLine: 50 });
  });

  it('rejeita fim sem início e fim anterior ao início', () => {
    const db = seed();
    expect(() => addFinding(db, 'j1', { ...base, endLine: 50 }, context())).toThrow(FindingError);
    expect(() => addFinding(db, 'j1', { ...base, line: 50, endLine: 44 }, context())).toThrow(/anterior/i);
  });

  it('rejeita linhas não positivas ou não inteiras', () => {
    const db = seed();
    for (const line of [0, -1, 1.5]) {
      expect(() => addFinding(db, 'j1', { ...base, line }, context())).toThrow(FindingError);
    }
    expect(() => addFinding(db, 'j1', { ...base, line: 44, endLine: 45.5 }, context())).toThrow(FindingError);
  });

  it('rejeita arquivo fora da PR', () => {
    const db = seed();
    expect(() => addFinding(db, 'j1', { ...base, path: 'src/c.ts', line: 1 }, context())).toThrow(FindingError);
  });

  it('rejeita duplicado com título normalizado', () => {
    const db = seed();
    addFinding(db, 'j1', { ...base, line: 44 }, context());
    expect(() =>
      addFinding(db, 'j1', { ...base, title: '  BUG   CRÍTICO  ', line: 44 }, context()),
    ).toThrow(/duplicado/i);
  });

  it('respeita o limite total somando inline e gerais', () => {
    const db = seed();
    const ctx = context({ maxFindings: 2 });
    addFinding(db, 'j1', { ...base, line: 44 }, ctx);
    addGeneralFinding(db, 'j1', { severity: 'medium', title: 'Geral um', bodyMd: 'corpo' }, ctx.maxFindings);
    expect(() => addFinding(db, 'j1', { ...base, title: 'Terceiro', line: 45 }, ctx)).toThrow(/Limite de 2/);
    expect(() =>
      addGeneralFinding(db, 'j1', { severity: 'medium', title: 'Geral dois', bodyMd: 'corpo' }, ctx.maxFindings),
    ).toThrow(/Limite de 2/);
  });

  it('aplica o limite adicional de 10 achados gerais', () => {
    const db = seed();
    for (let index = 0; index < MAX_GENERAL_FINDINGS; index += 1) {
      addGeneralFinding(db, 'j1', { severity: 'medium', title: `Geral ${index}`, bodyMd: 'corpo' }, 25);
    }
    expect(() =>
      addGeneralFinding(db, 'j1', { severity: 'medium', title: 'Geral excedente', bodyMd: 'corpo' }, 25),
    ).toThrow(/10 achados gerais/);
    expect(listFindings(db, 'j1')).toHaveLength(MAX_GENERAL_FINDINGS);
  });

  it('rejeita duplicado entre achados gerais', () => {
    const db = seed();
    addGeneralFinding(db, 'j1', { severity: 'medium', title: 'Problema geral', bodyMd: 'corpo' }, 25);
    expect(() =>
      addGeneralFinding(db, 'j1', { severity: 'medium', title: '  PROBLEMA   GERAL ', bodyMd: 'outro' }, 25),
    ).toThrow(/duplicado/i);
    addGeneralFinding(db, 'j1', { severity: 'critical', title: 'Problema geral', bodyMd: 'corpo' }, 25);
    expect(listFindings(db, 'j1')).toHaveLength(2);
  });

  it('redige título, corpo, sugestão e snippet e sinaliza no corpo', () => {
    const db = seed();
    const snippetLines: DiffLine[] = [
      { type: 'context', oldLine: 43, newLine: 43, text: 'const safe = true;' },
      { type: 'add', oldLine: null, newLine: 44, text: `const token = '${TOKEN}';` },
    ];
    addFinding(
      db,
      'j1',
      {
        ...base,
        title: `Token ${TOKEN}`,
        bodyMd: `Corpo com ${TOKEN}`,
        suggestionMd: `Use ambiente para ${TOKEN}`,
        line: 44,
        snippet: { lines: snippetLines, targetLine: 44 },
      },
      context(),
    );
    const row = listFindings(db, 'j1')[0]!;
    expect(row.title).toContain('[REDACTED]');
    expect(row.title).not.toContain(TOKEN);
    expect(row.bodyMd).toContain('[REDACTED]');
    expect(row.bodyMd).not.toContain(TOKEN);
    expect(row.bodyMd).toContain(SECRET_REDACTION_NOTE);
    expect(row.bodyMd.split(SECRET_REDACTION_NOTE)).toHaveLength(2);
    expect(row.suggestionMd).toContain('[REDACTED]');
    expect(row.suggestionMd).not.toContain(TOKEN);
    const snippet = JSON.parse(row.snippetJson!) as { lines: DiffLine[]; targetLine: number };
    expect(snippet.targetLine).toBe(44);
    expect(snippet.lines[1]!.text).toContain('[REDACTED]');
    expect(snippet.lines[1]!.text).not.toContain(TOKEN);
  });

  it('redige achados gerais e sinaliza no corpo', () => {
    const db = seed();
    addGeneralFinding(db, 'j1', { severity: 'medium', title: `Token ${TOKEN}`, bodyMd: `Corpo ${TOKEN}` }, 25);
    const row = listFindings(db, 'j1')[0]!;
    expect(row.bodyMd).toContain('[REDACTED]');
    expect(row.bodyMd).toContain(SECRET_REDACTION_NOTE);
    expect(row.title).not.toContain(TOKEN);
  });

  it('não adiciona aviso quando não há segredo', () => {
    const db = seed();
    addFinding(db, 'j1', { ...base, line: 44 }, context());
    expect(listFindings(db, 'j1')[0]!.bodyMd).toBe('corpo');
  });
});
