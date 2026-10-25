import type { FastifyInstance } from 'fastify';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import type { AppDeps } from '../app';
import { aiProfiles, events, githubCredentials, jobs, repositories, reviewFindings, reviews, webhookDeliveries } from '../../db/schema';
import { requireRole } from '../../auth/guards';
import { getSetting } from '../../db/settings';
import { getSystemSettings } from './settings-system';
import { isQueuePaused } from './queue';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const COMPLETED_STATUSES = new Set(['succeeded', 'partial', 'failed']);

export type DashboardData = {
  queue: { queued: number; running: number; paused: boolean; concurrency: number };
  reviews: { total: number; last24h: number; last7d: number };
  failures: number;
  failuresLast7d: number;
  failureRate7d: number;
  tokens: { input: number; output: number; last7dInput: number; last7dOutput: number };
  avgDurationSec7d: number | null;
  current: { id: string; prNumber: number; prTitle: string; prUrl: string; repoFullName: string; queuedAt: number; startedAt: number | null } | null;
  liveQueue: Array<{ id: string; prNumber: number; prTitle: string; prUrl: string; repoFullName: string; status: 'queued' | 'running'; queuedAt: number; startedAt: number | null }>;
  recentReviews: Array<{ id: string; jobId: string; prNumber: number; prTitle: string; repoFullName: string; status: string; commentsPosted: number; postedAt: number | null; critical: number; medium: number; suggestion: number }>;
  findings: { critical: number; medium: number; suggestion: number; strength: number; total: number; topRepositories: Array<{ fullName: string; count: number }> };
  trends: Array<{ date: string; reviews: number; failures: number; tokens: number }>;
  health: { pollerPaused: boolean; queuePaused: boolean; pollAuthFailures: number; lastPollAt: number | null; webhookFailures24h: number };
  onboarding: { githubConfigured: boolean; activeProfile: boolean; pollingEnabled: boolean };
};

type FindingCounts = { critical: number; medium: number; suggestion: number; strength: number };

function tokenValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function parseTokenUsage(usageJson: string | null): { input: number; output: number } {
  if (!usageJson) {
    return { input: 0, output: 0 };
  }
  try {
    const parsed: unknown = JSON.parse(usageJson);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { input: 0, output: 0 };
    }
    const usage = parsed as Record<string, unknown>;
    return { input: tokenValue(usage.input), output: tokenValue(usage.output) };
  } catch {
    return { input: 0, output: 0 };
  }
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function utcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function emptyCounts(): FindingCounts {
  return { critical: 0, medium: 0, suggestion: 0, strength: 0 };
}

export function registerDashboardRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/dashboard', { preHandler: requireRole(deps, 'viewer', 'operator', 'admin') }, async () => {
    const now = Date.now();
    const last24hStart = now - DAY_MS;
    const last7dStart = now - WEEK_MS;

    const jobRows = deps.db
      .select({
        id: jobs.id,
        repositoryId: jobs.repositoryId,
        prNumber: jobs.prNumber,
        prTitle: jobs.prTitle,
        prUrl: jobs.prUrl,
        status: jobs.status,
        queuedAt: jobs.queuedAt,
        startedAt: jobs.startedAt,
        finishedAt: jobs.finishedAt,
        usageJson: jobs.usageJson,
      })
      .from(jobs)
      .all();
    const repositoryRows = deps.db.select({ id: repositories.id, fullName: repositories.fullName }).from(repositories).all();
    const reviewRows = deps.db
      .select({
        id: reviews.id,
        jobId: reviews.jobId,
        status: reviews.status,
        commentsPosted: reviews.commentsPosted,
        postedAt: reviews.postedAt,
      })
      .from(reviews)
      .all();
    const findingRows = deps.db.select({ jobId: reviewFindings.jobId, severity: reviewFindings.severity }).from(reviewFindings).all();

    const repoNameById = new Map(repositoryRows.map((repository) => [repository.id, repository.fullName]));
    const jobById = new Map(jobRows.map((job) => [job.id, job]));

    const queued = jobRows.filter((job) => job.status === 'queued').length;
    const running = jobRows.filter((job) => job.status === 'running').length;
    const failed = jobRows.filter((job) => job.status === 'failed');
    const failuresLast7d = failed.filter((job) => job.finishedAt !== null && job.finishedAt >= last7dStart).length;
    const completedLast7d = jobRows.filter(
      (job) => COMPLETED_STATUSES.has(job.status) && job.finishedAt !== null && job.finishedAt >= last7dStart,
    );
    const failureRate7d = completedLast7d.length === 0 ? 0 : failuresLast7d / completedLast7d.length;

    let input = 0;
    let output = 0;
    let last7dInput = 0;
    let last7dOutput = 0;
    let durationTotalMs = 0;
    let durationCount = 0;
    for (const job of jobRows) {
      const usage = parseTokenUsage(job.usageJson);
      input += usage.input;
      output += usage.output;
      if (job.finishedAt !== null && job.finishedAt >= last7dStart) {
        last7dInput += usage.input;
        last7dOutput += usage.output;
      }
      if (
        COMPLETED_STATUSES.has(job.status) &&
        job.startedAt !== null &&
        job.finishedAt !== null &&
        job.finishedAt >= last7dStart &&
        job.finishedAt >= job.startedAt
      ) {
        durationTotalMs += job.finishedAt - job.startedAt;
        durationCount += 1;
      }
    }
    const avgDurationSec7d = durationCount === 0 ? null : Math.round(durationTotalMs / durationCount / 1000);

    const activeJobs = jobRows.filter((job) => job.status === 'queued' || job.status === 'running');
    const runningJobs = activeJobs
      .filter((job) => job.status === 'running')
      .sort((a, b) => (a.startedAt ?? a.queuedAt) - (b.startedAt ?? b.queuedAt));
    const queuedJobs = activeJobs.filter((job) => job.status === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
    const liveJobs = [...runningJobs, ...queuedJobs].slice(0, 6);
    const currentJob = runningJobs[0] ?? null;
    const toLiveItem = (job: (typeof jobRows)[number]) => ({
      id: job.id,
      prNumber: job.prNumber,
      prTitle: job.prTitle,
      prUrl: job.prUrl,
      repoFullName: repoNameById.get(job.repositoryId) ?? '',
      queuedAt: job.queuedAt,
      startedAt: job.startedAt,
    });
    const current = currentJob === null ? null : toLiveItem(currentJob);
    const liveQueue = liveJobs.map((job) => ({
      ...toLiveItem(job),
      status: job.status === 'running' ? ('running' as const) : ('queued' as const),
    }));

    const findingCountsByJob = new Map<string, FindingCounts>();
    const severityTotals = emptyCounts();
    const findingsByRepository = new Map<string, number>();
    for (const finding of findingRows) {
      const counts = findingCountsByJob.get(finding.jobId) ?? emptyCounts();
      counts[finding.severity] += 1;
      findingCountsByJob.set(finding.jobId, counts);
      severityTotals[finding.severity] += 1;
      const job = jobById.get(finding.jobId);
      if (job) {
        findingsByRepository.set(job.repositoryId, (findingsByRepository.get(job.repositoryId) ?? 0) + 1);
      }
    }
    const totalFindings = findingRows.length;
    const topRepositories = [...findingsByRepository.entries()]
      .map(([repositoryId, total]) => ({ fullName: repoNameById.get(repositoryId) ?? repositoryId, count: total }))
      .sort((a, b) => b.count - a.count || a.fullName.localeCompare(b.fullName))
      .slice(0, 5);

    const recentReviews = [...reviewRows]
      .sort((a, b) => (b.postedAt ?? Number.NEGATIVE_INFINITY) - (a.postedAt ?? Number.NEGATIVE_INFINITY))
      .slice(0, 5)
      .map((review) => {
        const job = jobById.get(review.jobId);
        const counts = findingCountsByJob.get(review.jobId) ?? emptyCounts();
        return {
          id: review.id,
          jobId: review.jobId,
          prNumber: job?.prNumber ?? 0,
          prTitle: job?.prTitle ?? '',
          repoFullName: job ? (repoNameById.get(job.repositoryId) ?? '') : '',
          status: review.status,
          commentsPosted: review.commentsPosted,
          postedAt: review.postedAt,
          critical: counts.critical,
          medium: counts.medium,
          suggestion: counts.suggestion,
        };
      });

    const todayUtc = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    );
    const trendByDate = new Map<string, { date: string; reviews: number; failures: number; tokens: number }>();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = utcDateKey(todayUtc - offset * DAY_MS);
      trendByDate.set(date, { date, reviews: 0, failures: 0, tokens: 0 });
    }
    for (const review of reviewRows) {
      if (review.postedAt === null) {
        continue;
      }
      const trend = trendByDate.get(utcDateKey(review.postedAt));
      if (trend) {
        trend.reviews += 1;
      }
    }
    for (const job of jobRows) {
      if (job.finishedAt === null) {
        continue;
      }
      const trend = trendByDate.get(utcDateKey(job.finishedAt));
      if (!trend) {
        continue;
      }
      if (job.status === 'failed') {
        trend.failures += 1;
      }
      const usage = parseTokenUsage(job.usageJson);
      trend.tokens += usage.input + usage.output;
    }

    const lastPoll = deps.db
      .select({ createdAt: events.createdAt })
      .from(events)
      .where(eq(events.type, 'poll.updated'))
      .orderBy(desc(events.createdAt))
      .limit(1)
      .get();
    const webhookFailures24h =
      deps.db
        .select({ value: count() })
        .from(webhookDeliveries)
        .where(and(eq(webhookDeliveries.success, false), gte(webhookDeliveries.createdAt, last24hStart)))
        .get()?.value ?? 0;

    const githubConfigured =
      deps.db.select({ id: githubCredentials.id }).from(githubCredentials).limit(1).get() !== undefined;
    const activeProfile =
      deps.db.select({ id: aiProfiles.id }).from(aiProfiles).where(eq(aiProfiles.isActive, true)).limit(1).get() !==
      undefined;

    const data: DashboardData = {
      queue: { queued, running, paused: isQueuePaused(deps.db), concurrency: getSystemSettings(deps.db).concurrency },
      reviews: {
        total: reviewRows.length,
        last24h: reviewRows.filter((review) => review.postedAt !== null && review.postedAt >= last24hStart).length,
        last7d: reviewRows.filter((review) => review.postedAt !== null && review.postedAt >= last7dStart).length,
      },
      failures: failed.length,
      failuresLast7d,
      failureRate7d,
      tokens: { input, output, last7dInput, last7dOutput },
      avgDurationSec7d,
      current,
      liveQueue,
      recentReviews,
      findings: { ...severityTotals, total: totalFindings, topRepositories },
      trends: [...trendByDate.values()],
      health: {
        pollerPaused: getSetting<boolean>(deps.db, 'poller_paused') === true,
        queuePaused: isQueuePaused(deps.db),
        pollAuthFailures: nonNegativeNumber(getSetting<unknown>(deps.db, 'poll_auth_failures')),
        lastPollAt: lastPoll?.createdAt ?? null,
        webhookFailures24h,
      },
      onboarding: { githubConfigured, activeProfile, pollingEnabled: githubConfigured && activeProfile },
    };
    return data;
  });
}
