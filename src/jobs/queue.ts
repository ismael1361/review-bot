import { and, asc, count, desc, eq, isNull, lte, ne, or } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { AppError } from '../api/errors';
import { isQueuePaused } from '../api/routes/queue';
import { getActiveProfile, profileSnapshotJson } from '../ai/profiles';
import type { Db } from '../db/client';
import { jobs, prSeen, repositories } from '../db/schema';
import { githubJson } from '../github/client';
import { getGithubCredentials } from '../github/credentials';

export type JobRow = typeof jobs.$inferSelect;

export class RetryableJobError extends Error {
  constructor(message: string, readonly retryAfterMs?: number) {
    super(message);
  }
}

export class StaleClaimError extends Error {}

export function assertJobClaimCurrent(db: Db, job: JobRow): void {
  if (job.status !== 'running' || !job.lockedBy) {
    return;
  }
  const current = db.select({ status: jobs.status, lockedBy: jobs.lockedBy }).from(jobs).where(eq(jobs.id, job.id)).get();
  if (!current || current.status !== 'running' || current.lockedBy !== job.lockedBy) {
    throw new StaleClaimError('Execução substituída; publicação ignorada');
  }
}

export function claimNextJob(db: Db, workerId: string, now = Date.now()): JobRow | undefined {
  if (isQueuePaused(db)) {
    return undefined;
  }
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, 'queued'), or(isNull(jobs.nextAttemptAt), lte(jobs.nextAttemptAt, now))))
      .orderBy(desc(jobs.priority), asc(jobs.queuedAt))
      .limit(1)
      .get();
    if (!row) {
      return undefined;
    }
    tx.update(jobs)
      .set({
        status: 'running',
        lockedBy: workerId,
        startedAt: now,
        heartbeatAt: now,
        attempts: row.attempts + 1,
        errorCode: null,
        errorMessage: null,
      })
      .where(and(eq(jobs.id, row.id), eq(jobs.status, 'queued')))
      .run();
    return tx.select().from(jobs).where(eq(jobs.id, row.id)).get();
  });
}

export function heartbeat(db: Db, jobId: string, now = Date.now()): void {
  db.update(jobs).set({ heartbeatAt: now }).where(eq(jobs.id, jobId)).run();
}

export function recoverOrphans(db: Db, staleMs = 120_000, now = Date.now()): number {
  const result = db
    .update(jobs)
    .set({ status: 'queued', lockedBy: null, nextAttemptAt: now })
    .where(and(eq(jobs.status, 'running'), or(isNull(jobs.heartbeatAt), lte(jobs.heartbeatAt, now - staleMs))))
    .run();
  return result.changes;
}

export function cancelJob(db: Db, jobId: string, now = Date.now()): boolean {
  const row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!row || (row.status !== 'queued' && row.status !== 'running')) {
    return false;
  }
  db.update(jobs).set({ status: 'cancelled', finishedAt: now, lockedBy: null }).where(eq(jobs.id, jobId)).run();
  return true;
}

export function retryJob(db: Db, jobId: string, now = Date.now()): boolean {
  const row = db.select().from(jobs).where(eq(jobs.id, jobId)).get();
  if (!row || (row.status !== 'failed' && row.status !== 'cancelled')) {
    return false;
  }
  db.update(jobs)
    .set({
      status: 'queued',
      attempts: 0,
      nextAttemptAt: now,
      errorCode: null,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      lockedBy: null,
    })
    .where(eq(jobs.id, jobId))
    .run();
  return true;
}

export function isJobCancelled(db: Db, jobId: string): boolean {
  const row = db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, jobId)).get();
  return row?.status === 'cancelled';
}

export function queueDepth(db: Db): { queued: number; running: number } {
  const queued = db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'queued')).get()?.value ?? 0;
  const running = db.select({ value: count() }).from(jobs).where(eq(jobs.status, 'running')).get()?.value ?? 0;
  return { queued, running };
}

type ManualDeps = { db: Db; encryptionKey: Buffer; fetchImpl?: typeof fetch };

export async function enqueueManual(
  deps: ManualDeps,
  input: { repoFullName: string; prNumber: number; force?: boolean },
): Promise<string> {
  const profile = getActiveProfile(deps.db, deps.encryptionKey);
  if (!profile) {
    throw new AppError('Nenhum perfil de IA ativo', 'no_active_profile', 409);
  }
  const credentials = getGithubCredentials(deps.db, deps.encryptionKey);
  if (!credentials) {
    throw new AppError('Credencial GitHub ausente', 'github_token_missing', 400);
  }
  const [owner, name] = input.repoFullName.split('/');
  if (!owner || !name) {
    throw new AppError('Use owner/repo', 'invalid_repo', 400);
  }
  const repoInfo = (
    await githubJson<{ id: number; full_name: string; archived: boolean; private: boolean }>(`/repos/${owner}/${name}`, {
      token: credentials.pat,
      fetchImpl: deps.fetchImpl,
    })
  ).data;
  const pull = (
    await githubJson<{
      title: string;
      html_url: string;
      draft: boolean;
      head: { sha: string; repo?: { full_name: string } | null };
      base: { sha: string };
      user: { login: string };
    }>(
      `/repos/${owner}/${name}/pulls/${input.prNumber}`,
      { token: credentials.pat, fetchImpl: deps.fetchImpl },
    )
  ).data;
  const now = Date.now();
  deps.db
    .insert(repositories)
    .values({
      id: uuidv7(),
      githubId: String(repoInfo.id),
      owner,
      name,
      fullName: repoInfo.full_name,
      private: repoInfo.private,
      archived: repoInfo.archived,
      enabled: true,
      discoveredAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: repositories.fullName,
      set: { private: repoInfo.private, archived: repoInfo.archived, updatedAt: now },
    })
    .run();
  const repo = deps.db.select().from(repositories).where(eq(repositories.fullName, repoInfo.full_name)).get();
  if (!repo) {
    throw new Error(`Repositório não persistido: ${repoInfo.full_name}`);
  }
  const headRepo = pull.head.repo?.full_name ?? repo.fullName;
  const existing = deps.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.repositoryId, repo.id), eq(jobs.prNumber, input.prNumber), eq(jobs.headSha, pull.head.sha)))
    .all();
  if (existing.length > 0 && !input.force) {
    throw new AppError('Este SHA já foi enfileirado; use force para nova execução', 'job_exists', 409);
  }
  const runSeq = existing.reduce((max, job) => Math.max(max, job.runSeq), 0) + 1;
  const jobId = uuidv7();
  deps.db
    .insert(jobs)
    .values({
      id: jobId,
      repositoryId: repo.id,
      prNumber: input.prNumber,
      prTitle: pull.title,
      prUrl: pull.html_url,
      authorLogin: pull.user.login,
      headSha: pull.head.sha,
      baseSha: pull.base.sha,
      headRepo,
      runSeq,
      status: 'queued',
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      profileId: profile.id,
      profileSnapshotJson: profileSnapshotJson(profile),
      queuedAt: now,
      nextAttemptAt: now,
    })
    .run();
  deps.db
    .insert(prSeen)
    .values({ repositoryId: repo.id, prNumber: input.prNumber, lastUpdatedAt: now, lastHeadSha: pull.head.sha, headRepo })
    .onConflictDoUpdate({
      target: [prSeen.repositoryId, prSeen.prNumber],
      set: { lastUpdatedAt: now, lastHeadSha: pull.head.sha, headRepo },
    })
    .run();
  return jobId;
}

export function markJobFinished(
  db: Db,
  jobId: string,
  patch: {
    status: 'succeeded' | 'partial' | 'failed' | 'cancelled';
    errorCode?: string;
    errorMessage?: string;
    usageJson?: string;
    now?: number;
    workerId?: string;
  },
): void {
  const now = patch.now ?? Date.now();
  const where = patch.workerId
    ? and(eq(jobs.id, jobId), ne(jobs.status, 'cancelled'), eq(jobs.status, 'running'), eq(jobs.lockedBy, patch.workerId))
    : and(eq(jobs.id, jobId), ne(jobs.status, 'cancelled'));
  db.update(jobs)
    .set({
      status: patch.status,
      errorCode: patch.errorCode ?? null,
      errorMessage: patch.errorMessage ?? null,
      usageJson: patch.usageJson ?? null,
      finishedAt: now,
      lockedBy: null,
    })
    .where(where)
    .run();
}

export function scheduleRetry(
  db: Db,
  jobId: string,
  delayMs: number,
  errorCode: string,
  errorMessage: string,
  now = Date.now(),
  workerId?: string,
): void {
  const where = workerId
    ? and(eq(jobs.id, jobId), ne(jobs.status, 'cancelled'), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId))
    : and(eq(jobs.id, jobId), ne(jobs.status, 'cancelled'));
  db.update(jobs)
    .set({ status: 'queued', lockedBy: null, nextAttemptAt: now + delayMs, errorCode, errorMessage })
    .where(where)
    .run();
}

export const RETRY_DELAYS_MS = [30_000, 120_000, 480_000];
