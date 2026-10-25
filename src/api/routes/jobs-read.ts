import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, exists, getTableColumns, gte, inArray, isNotNull, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { jobs, repositories, reviewFindings, reviews } from '../../db/schema';
import { requireRole } from '../../auth/guards';

const DAY_MS = 24 * 60 * 60 * 1000;

const ListQuery = z.object({
  status: z.enum(['queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled']).optional(),
  repositoryId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const ReviewListQuery = z.object({
  repoFullName: z.string().min(1).optional(),
  prNumber: z.coerce.number().int().min(1).optional(),
  status: z.enum(['posted', 'fallback', 'failed']).optional(),
  severity: z.enum(['critical', 'medium', 'suggestion', 'strength']).optional(),
  periodDays: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type ReviewCounts = { critical: number; medium: number; suggestion: number };

function paginate(query: { page: number; limit: number }) {
  return { offset: (query.page - 1) * query.limit, limit: query.limit };
}

export function registerJobReadRoutes(app: FastifyInstance, deps: AppDeps): void {
  const viewer = requireRole(deps, 'viewer', 'operator', 'admin');

  app.get('/api/jobs', { preHandler: viewer }, async (request) => {
    const query = ListQuery.parse(request.query);
    const filters: SQL[] = [];
    if (query.status) {
      filters.push(eq(jobs.status, query.status));
    }
    if (query.repositoryId) {
      filters.push(eq(jobs.repositoryId, query.repositoryId));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const { offset, limit } = paginate(query);
    const queuedRows = deps.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.status, 'queued'))
      .orderBy(desc(jobs.priority), asc(jobs.queuedAt))
      .all();
    const queuePositionById = new Map(queuedRows.map((row, index) => [row.id, index + 1]));
    const rows = deps.db
      .select({ ...getTableColumns(jobs), repoFullName: repositories.fullName })
      .from(jobs)
      .leftJoin(repositories, eq(jobs.repositoryId, repositories.id))
      .where(where)
      .orderBy(desc(jobs.queuedAt))
      .limit(limit)
      .offset(offset)
      .all()
      .map((row) => ({
        ...row,
        repoFullName: row.repoFullName ?? '',
        queuePosition: queuePositionById.get(row.id) ?? null,
      }));
    const total = deps.db.select({ value: count() }).from(jobs).where(where).get()?.value ?? 0;
    return { jobs: rows, total, page: query.page, limit: query.limit };
  });

  app.get('/api/reviews', { preHandler: viewer }, async (request) => {
    const query = ReviewListQuery.parse(request.query);
    const now = Date.now();
    const periodStart = query.periodDays === undefined ? null : now - query.periodDays * DAY_MS;
    const filters: SQL[] = [];
    if (query.repoFullName !== undefined) {
      filters.push(eq(repositories.fullName, query.repoFullName));
    }
    if (query.prNumber !== undefined) {
      filters.push(eq(jobs.prNumber, query.prNumber));
    }
    if (query.status !== undefined) {
      filters.push(eq(reviews.status, query.status));
    }
    if (periodStart !== null) {
      const periodFilter = and(isNotNull(reviews.postedAt), gte(reviews.postedAt, periodStart));
      if (periodFilter) {
        filters.push(periodFilter);
      }
    }
    if (query.severity !== undefined) {
      const severityExists = deps.db
        .select({ jobId: reviewFindings.jobId })
        .from(reviewFindings)
        .where(and(eq(reviewFindings.jobId, jobs.id), eq(reviewFindings.severity, query.severity)));
      filters.push(exists(severityExists));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const { offset, limit } = paginate(query);
    const total =
      deps.db
        .select({ value: count() })
        .from(reviews)
        .innerJoin(jobs, eq(reviews.jobId, jobs.id))
        .innerJoin(repositories, eq(jobs.repositoryId, repositories.id))
        .where(where)
        .get()?.value ?? 0;
    const rows = deps.db
      .select({
        id: reviews.id,
        jobId: reviews.jobId,
        githubReviewId: reviews.githubReviewId,
        url: reviews.url,
        body: reviews.body,
        event: reviews.event,
        commentsPosted: reviews.commentsPosted,
        commentsFallback: reviews.commentsFallback,
        status: reviews.status,
        postedAt: reviews.postedAt,
        repoFullName: repositories.fullName,
        prNumber: jobs.prNumber,
        prTitle: jobs.prTitle,
      })
      .from(reviews)
      .innerJoin(jobs, eq(reviews.jobId, jobs.id))
      .innerJoin(repositories, eq(jobs.repositoryId, repositories.id))
      .where(where)
      .orderBy(desc(reviews.postedAt))
      .limit(limit)
      .offset(offset)
      .all();
    const jobIds = rows.map((row) => row.jobId);
    const findingRows =
      jobIds.length === 0
        ? []
        : deps.db
            .select({ jobId: reviewFindings.jobId, severity: reviewFindings.severity })
            .from(reviewFindings)
            .where(inArray(reviewFindings.jobId, jobIds))
            .all();
    const findingsByJob = new Map<string, ReviewCounts>();
    for (const finding of findingRows) {
      if (finding.severity === 'strength') {
        continue;
      }
      const entry = findingsByJob.get(finding.jobId) ?? { critical: 0, medium: 0, suggestion: 0 };
      entry[finding.severity] += 1;
      findingsByJob.set(finding.jobId, entry);
    }
    const reviewsPage = rows.map((row) => {
      const entry = findingsByJob.get(row.jobId);
      return {
        ...row,
        critical: entry?.critical ?? 0,
        medium: entry?.medium ?? 0,
        suggestion: entry?.suggestion ?? 0,
      };
    });
    return {
      reviews: reviewsPage,
      total,
      page: query.page,
      limit: query.limit,
    };
  });
}
