import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { repositories, reviewFindings, reviews } from '../db/schema';
import { listFindings, type FindingRow } from '../jobs/findings';
import { GitHubError, githubFetch, paginate } from './client';

export type PublishDeps = { db: Db; token: string; fetchImpl?: typeof fetch; now?: () => number };

export type PublishResult = {
  status: 'posted' | 'fallback' | 'failed';
  reviewId?: string;
  url?: string;
  commentsPosted: number;
  commentsFallback: number;
  retryable?: boolean;
  error?: string;
};

export type PublishJob = {
  id: string;
  repositoryId: string;
  prNumber: number;
  headSha: string;
};

type RemoteReview = {
  id: number;
  body: string | null;
  html_url: string;
};

type ReviewRowValues = {
  githubReviewId: string | null;
  url: string | null;
  body: string;
  commentsPosted: number;
  commentsFallback: number;
  status: 'posted' | 'fallback' | 'failed';
  postedAt: number | null;
};

type InlineComment = {
  path: string;
  line: number;
  side: 'RIGHT';
  body: string;
  start_line?: number;
  start_side?: 'RIGHT';
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: '[CRÍTICO]',
  medium: '[MÉDIO]',
  suggestion: '[SUGESTÃO]',
  strength: '[PONTO FORTE]',
};

const PUBLISHABLE_STATUSES = new Set(['valid', 'outside_diff', 'posted', 'fallback']);
const INLINE_STATUSES = new Set(['valid', 'posted']);

function severityHeading(finding: FindingRow): string {
  const label = SEVERITY_LABEL[finding.severity];
  return label ? `${label} ${finding.title}` : finding.title;
}

function targetLine(finding: FindingRow): number | null {
  return finding.endLine ?? finding.startLine;
}

function isInline(finding: FindingRow): boolean {
  return INLINE_STATUSES.has(finding.status) && finding.path !== '' && targetLine(finding) !== null;
}

function commentBody(finding: FindingRow): string {
  const parts = [`**${severityHeading(finding)}**`, '', finding.bodyMd];
  if (finding.suggestionMd) {
    parts.push('', '**Sugestão:**', '```', finding.suggestionMd, '```');
  }
  return parts.join('\n');
}

function buildComments(inline: FindingRow[]): InlineComment[] {
  return inline.map((finding) => {
    const line = targetLine(finding);
    if (line === null) {
      throw new Error('Achado inline sem linha');
    }
    if (finding.startLine !== null && finding.endLine !== null && finding.startLine !== finding.endLine) {
      return {
        path: finding.path,
        start_line: finding.startLine,
        start_side: 'RIGHT',
        line: finding.endLine,
        side: 'RIGHT',
        body: commentBody(finding),
      };
    }
    return { path: finding.path, line, side: 'RIGHT', body: commentBody(finding) };
  });
}

export function buildReviewBody(marker: string, summary: string, fallbackFindings: FindingRow[]): string {
  const parts = [marker, '', summary];
  if (fallbackFindings.length > 0) {
    parts.push('', '### Achados sem linha no diff');
    for (const finding of fallbackFindings) {
      const line = targetLine(finding);
      const location = finding.path ? ` — \`${finding.path}${line === null ? '' : `:${line}`}\`` : '';
      parts.push('', `**${severityHeading(finding)}**${location}`, '', finding.bodyMd);
      if (finding.suggestionMd) {
        parts.push('', '**Sugestão:**', '```', finding.suggestionMd, '```');
      }
    }
  }
  return parts.join('\n');
}

function saveReviewRow(db: Db, jobId: string, values: ReviewRowValues): string {
  const existing = db.select({ id: reviews.id }).from(reviews).where(eq(reviews.jobId, jobId)).get();
  if (existing) {
    db.update(reviews).set(values).where(eq(reviews.id, existing.id)).run();
    return existing.id;
  }
  const id = uuidv7();
  db.insert(reviews).values({ id, jobId, event: 'COMMENT', ...values }).run();
  return id;
}

function markFindings(db: Db, inline: FindingRow[], fallback: FindingRow[], reviewId: string): void {
  for (const finding of inline) {
    db.update(reviewFindings).set({ status: 'posted', reviewId }).where(eq(reviewFindings.id, finding.id)).run();
  }
  for (const finding of fallback) {
    db.update(reviewFindings).set({ status: 'fallback', reviewId }).where(eq(reviewFindings.id, finding.id)).run();
  }
}

function markAllFallback(db: Db, findings: FindingRow[], reviewId: string): void {
  for (const finding of findings) {
    db.update(reviewFindings).set({ status: 'fallback', reviewId }).where(eq(reviewFindings.id, finding.id)).run();
  }
}

function failedResult(db: Db, job: PublishJob, body: string, error: unknown, retryable?: boolean): PublishResult {
  const existing = db.select().from(reviews).where(eq(reviews.jobId, job.id)).get();
  const resultRetryable = retryable ?? (error instanceof GitHubError ? error.retryable : true);
  const resultError = error instanceof Error ? error.message : 'falha ao publicar review';
  if (existing && existing.githubReviewId !== null && (existing.status === 'posted' || existing.status === 'fallback')) {
    return {
      status: 'failed',
      reviewId: existing.githubReviewId,
      url: existing.url ?? undefined,
      commentsPosted: existing.commentsPosted,
      commentsFallback: existing.commentsFallback,
      retryable: resultRetryable,
      error: resultError,
    };
  }
  saveReviewRow(db, job.id, {
    githubReviewId: null,
    url: null,
    body,
    commentsPosted: 0,
    commentsFallback: 0,
    status: 'failed',
    postedAt: null,
  });
  return {
    status: 'failed',
    commentsPosted: 0,
    commentsFallback: 0,
    retryable: resultRetryable,
    error: resultError,
  };
}

async function publishFallback(
  deps: PublishDeps,
  job: PublishJob,
  marker: string,
  summary: string,
  findings: FindingRow[],
  endpoint: string,
): Promise<PublishResult> {
  const body = buildReviewBody(marker, summary, findings);
  try {
    const { response } = await githubFetch(endpoint, {
      token: deps.token,
      fetchImpl: deps.fetchImpl,
      method: 'POST',
      body: { commit_id: job.headSha, event: 'COMMENT', body },
    });
    const data = (await response.json()) as { id: number; html_url: string };
    const reviewRowId = saveReviewRow(deps.db, job.id, {
      githubReviewId: String(data.id),
      url: data.html_url,
      body,
      commentsPosted: 0,
      commentsFallback: findings.length,
      status: 'fallback',
      postedAt: (deps.now ?? Date.now)(),
    });
    markAllFallback(deps.db, findings, reviewRowId);
    return {
      status: 'fallback',
      reviewId: String(data.id),
      url: data.html_url,
      commentsPosted: 0,
      commentsFallback: findings.length,
    };
  } catch (error) {
    return failedResult(deps.db, job, body, error);
  }
}

export async function publishReview(deps: PublishDeps, job: PublishJob, summary: string): Promise<PublishResult> {
  const db = deps.db;
  const marker = `<!-- pr-reviewer:job:${job.id} -->`;
  const repo = db.select().from(repositories).where(eq(repositories.id, job.repositoryId)).get();
  const publishable = listFindings(db, job.id).filter((finding) => PUBLISHABLE_STATUSES.has(finding.status));
  const inline = publishable.filter(isInline);
  const fallback = publishable.filter((finding) => !isInline(finding));
  const intendedBody = buildReviewBody(marker, summary, fallback);

  if (!repo) {
    return failedResult(db, job, intendedBody, new Error('Repositório não encontrado'), false);
  }

  const endpoint = `/repos/${repo.owner}/${repo.name}/pulls/${job.prNumber}/reviews`;

  let existing: RemoteReview[];
  try {
    existing = await paginate<RemoteReview>(endpoint, { token: deps.token, fetchImpl: deps.fetchImpl });
  } catch (error) {
    return failedResult(db, job, intendedBody, error);
  }

  const already = existing.find((review) => review.body?.includes(marker));
  if (already) {
    const commentsPosted = inline.length;
    const commentsFallback = fallback.length;
    const reviewRowId = saveReviewRow(db, job.id, {
      githubReviewId: String(already.id),
      url: already.html_url,
      body: already.body ?? intendedBody,
      commentsPosted,
      commentsFallback,
      status: 'posted',
      postedAt: (deps.now ?? Date.now)(),
    });
    markFindings(db, inline, fallback, reviewRowId);
    return { status: 'posted', reviewId: String(already.id), url: already.html_url, commentsPosted, commentsFallback };
  }

  const comments = buildComments(inline);
  const payload = {
    commit_id: job.headSha,
    event: 'COMMENT',
    body: intendedBody,
    comments,
  };

  try {
    const { response } = await githubFetch(endpoint, {
      token: deps.token,
      fetchImpl: deps.fetchImpl,
      method: 'POST',
      body: payload,
    });
    const data = (await response.json()) as { id: number; html_url: string };
    const reviewRowId = saveReviewRow(db, job.id, {
      githubReviewId: String(data.id),
      url: data.html_url,
      body: intendedBody,
      commentsPosted: comments.length,
      commentsFallback: fallback.length,
      status: 'posted',
      postedAt: (deps.now ?? Date.now)(),
    });
    markFindings(db, inline, fallback, reviewRowId);
    return {
      status: 'posted',
      reviewId: String(data.id),
      url: data.html_url,
      commentsPosted: comments.length,
      commentsFallback: fallback.length,
    };
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      return publishFallback(deps, job, marker, summary, publishable, endpoint);
    }
    return failedResult(db, job, intendedBody, error);
  }
}
