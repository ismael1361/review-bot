import { and, count, eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { reviewFindings } from '../db/schema';
import type { DiffLine } from '../github/diff';
import { redactSecrets } from '../shared/redact';

export const SECRET_REDACTION_NOTE = '\n\n_Segredos detectados foram redigidos automaticamente._';
export const MAX_GENERAL_FINDINGS = 10;

export class FindingError extends Error {}

export type FindingRow = typeof reviewFindings.$inferSelect;

export type FindingSeverity = 'critical' | 'medium' | 'suggestion' | 'strength';

export type FindingSnippet = {
  lines: DiffLine[];
  targetLine: number;
};

export type FindingInput = {
  path: string;
  line?: number;
  endLine?: number;
  severity: FindingSeverity;
  title: string;
  bodyMd: string;
  suggestionMd?: string;
  snippet?: FindingSnippet;
};

export type FindingContext = {
  validLines: Map<string, Set<number>>;
  filePaths: Set<string>;
  maxFindings: number;
};

type GeneralFindingInput = Omit<FindingInput, 'path' | 'line' | 'endLine' | 'snippet'>;

type RedactedFindingContent = {
  title: string;
  bodyMd: string;
  suggestionMd: string | null;
  snippetJson: string | null;
};

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

function totalFindings(db: Db, jobId: string): number {
  return db.select({ value: count() }).from(reviewFindings).where(eq(reviewFindings.jobId, jobId)).get()?.value ?? 0;
}

function generalFindings(db: Db, jobId: string): number {
  return db
    .select({ value: count() })
    .from(reviewFindings)
    .where(and(eq(reviewFindings.jobId, jobId), eq(reviewFindings.path, '')))
    .get()?.value ?? 0;
}

function assertLimit(db: Db, jobId: string, maxFindings: number): void {
  if (totalFindings(db, jobId) >= maxFindings) {
    throw new FindingError(`Limite de ${maxFindings} achados atingido; finalize com submit_review`);
  }
}

function assertLine(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new FindingError(`Linha inválida em ${field}`);
  }
}

function validateLineRange(input: Pick<FindingInput, 'line' | 'endLine'>): void {
  if (input.endLine !== undefined && input.line === undefined) {
    throw new FindingError('Linha final informada sem linha inicial');
  }
  assertLine(input.line, 'line');
  assertLine(input.endLine, 'endLine');
  if (input.line !== undefined && input.endLine !== undefined && input.endLine < input.line) {
    throw new FindingError('Linha final anterior à linha inicial');
  }
}

function redactFindingContent(
  input: Pick<FindingInput, 'title' | 'bodyMd' | 'suggestionMd' | 'snippet'>,
): RedactedFindingContent {
  const title = redactSecrets(input.title);
  const body = redactSecrets(input.bodyMd);
  const suggestion = input.suggestionMd === undefined ? undefined : redactSecrets(input.suggestionMd);
  let snippetRedacted = false;
  let snippet: FindingSnippet | undefined;
  if (input.snippet) {
    snippet = {
      targetLine: input.snippet.targetLine,
      lines: input.snippet.lines.map((line) => {
        const result = redactSecrets(line.text);
        if (!result.redacted) {
          return line;
        }
        snippetRedacted = true;
        return { ...line, text: result.text };
      }),
    };
  }
  const redacted = title.redacted || body.redacted || (suggestion?.redacted ?? false) || snippetRedacted;
  return {
    title: title.text,
    bodyMd: body.text + (redacted ? SECRET_REDACTION_NOTE : ''),
    suggestionMd: suggestion?.text ?? null,
    snippetJson: snippet ? JSON.stringify(snippet) : null,
  };
}

function duplicateFinding(
  db: Db,
  jobId: string,
  path: string,
  startLine: number | null,
  normalizedTitle: string,
  severity: FindingSeverity,
): boolean {
  return db
    .select()
    .from(reviewFindings)
    .where(and(eq(reviewFindings.jobId, jobId), eq(reviewFindings.path, path)))
    .all()
    .some(
      (row) =>
        normalizeTitle(row.title) === normalizedTitle &&
        row.severity === severity &&
        (row.startLine ?? null) === startLine,
    );
}

export function addFinding(
  db: Db,
  jobId: string,
  input: FindingInput,
  ctx: FindingContext,
): { findingId: string; status: 'valid' | 'outside_diff' } {
  validateLineRange(input);
  assertLimit(db, jobId, ctx.maxFindings);
  if (!ctx.filePaths.has(input.path)) {
    throw new FindingError(`Arquivo não pertence à PR: ${input.path}`);
  }
  const content = redactFindingContent(input);
  const startLine = input.line ?? null;
  const endLine = input.line === undefined ? null : input.endLine ?? input.line;
  if (duplicateFinding(db, jobId, input.path, startLine, normalizeTitle(content.title), input.severity)) {
    throw new FindingError('Achado duplicado');
  }
  const status = input.line !== undefined && ctx.validLines.get(input.path)?.has(input.line) === true ? 'valid' : 'outside_diff';
  const findingId = uuidv7();
  db.insert(reviewFindings)
    .values({
      id: findingId,
      jobId,
      reviewId: null,
      path: input.path,
      startLine,
      endLine,
      side: 'RIGHT',
      severity: input.severity,
      title: content.title,
      bodyMd: content.bodyMd,
      suggestionMd: content.suggestionMd,
      snippetJson: content.snippetJson,
      status,
      githubCommentId: null,
      createdAt: Date.now(),
    })
    .run();
  return { findingId, status };
}

export function addGeneralFinding(db: Db, jobId: string, input: GeneralFindingInput, maxFindings: number): string {
  assertLimit(db, jobId, maxFindings);
  if (generalFindings(db, jobId) >= MAX_GENERAL_FINDINGS) {
    throw new FindingError(`Limite de ${MAX_GENERAL_FINDINGS} achados gerais atingido; finalize com submit_review`);
  }
  const content = redactFindingContent(input);
  const normalizedTitle = normalizeTitle(content.title);
  const duplicate = db
    .select()
    .from(reviewFindings)
    .where(and(eq(reviewFindings.jobId, jobId), eq(reviewFindings.path, '')))
    .all()
    .some(
      (row) =>
        row.startLine === null &&
        row.endLine === null &&
        normalizeTitle(row.title) === normalizedTitle &&
        row.severity === input.severity,
    );
  if (duplicate) {
    throw new FindingError('Achado duplicado');
  }
  const findingId = uuidv7();
  db.insert(reviewFindings)
    .values({
      id: findingId,
      jobId,
      reviewId: null,
      path: '',
      startLine: null,
      endLine: null,
      side: 'RIGHT',
      severity: input.severity,
      title: content.title,
      bodyMd: content.bodyMd,
      suggestionMd: content.suggestionMd,
      snippetJson: null,
      status: 'outside_diff',
      githubCommentId: null,
      createdAt: Date.now(),
    })
    .run();
  return findingId;
}

export function listFindings(db: Db, jobId: string): FindingRow[] {
  return db.select().from(reviewFindings).where(eq(reviewFindings.jobId, jobId)).all();
}
