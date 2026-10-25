import { and, eq } from 'drizzle-orm';
import type { Buffer } from 'node:buffer';
import type { Logger } from 'pino';
import { v7 as uuidv7 } from 'uuid';
import type { Db } from '../db/client';
import { events, jobs, prSeen, repositories } from '../db/schema';
import { getSetting, setSetting } from '../db/settings';
import type { EventBus } from '../events/bus';
import { getGithubCredentials } from './credentials';
import { GitHubError, githubJson, paginate } from './client';
import { getSystemSettings } from '../api/routes/settings-system';
import { isQueuePaused } from '../api/routes/queue';
import { getActiveProfile, profileSnapshotJson } from '../ai/profiles';
import { dispatchEvent } from '../webhooks/dispatcher';

export type PollerDeps = {
  db: Db;
  bus: EventBus;
  logger: Logger;
  encryptionKey: Buffer;
  allowPrivate?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type PollResult = { found: number; enqueued: number; skipped: number };

type SearchItem = { number: number; repository_url: string; updated_at: string };
type RepoInfo = { id: number; full_name: string; archived: boolean; private: boolean };
type PullInfo = {
  title: string;
  html_url: string;
  draft: boolean;
  head: { sha: string; repo: { full_name: string } | null };
  base: { sha: string };
  user: { login: string };
};
type EventLevel = 'info' | 'warn' | 'error';

const SEARCH_PATH = '/search/issues?q=is:pr+is:open+review-requested:@me&sort=updated';

function emit(deps: PollerDeps, jobId: string | null, type: string, message: string, data?: unknown, level: EventLevel = 'info'): void {
  const now = (deps.now ?? Date.now)();
  deps.db.insert(events).values({ id: uuidv7(), jobId, level, type, message, dataJson: data === undefined ? null : JSON.stringify(data), createdAt: now }).run();
  deps.bus.publish({ type, data: data ?? { message }, at: now });
}

async function handlePollError(deps: PollerDeps, error: GitHubError, result: PollResult): Promise<PollResult | undefined> {
  if (error.retryable) {
    deps.logger.warn({ err: error }, 'falha temporária no polling');
    emit(deps, null, 'poll.updated', `Falha temporária no polling: ${error.message}`, { status: error.status, error: error.message }, 'warn');
    return result;
  }
  if (error.status === 401 || error.status === 403) {
    await recordPollAuthFailure(deps);
    return result;
  }
  return undefined;
}

export async function pollOnce(deps: PollerDeps): Promise<PollResult> {
  if (getSetting<boolean>(deps.db, 'poller_paused') === true) {
    return { found: 0, enqueued: 0, skipped: 0 };
  }
  if (isQueuePaused(deps.db)) {
    return { found: 0, enqueued: 0, skipped: 0 };
  }
  const profile = getActiveProfile(deps.db, deps.encryptionKey);
  if (!profile) {
    deps.logger.warn('polling sem perfil de IA ativo');
    emit(deps, null, 'poll.updated', 'Polling ignorado: nenhum perfil de IA ativo', { reason: 'no_active_profile' }, 'warn');
    return { found: 0, enqueued: 0, skipped: 0 };
  }
  const credentials = getGithubCredentials(deps.db, deps.encryptionKey);
  if (!credentials) {
    throw new GitHubError('Credencial GitHub ausente', 400, false, '');
  }
  const settings = getSystemSettings(deps.db);
  const token = credentials.pat;
  let items: SearchItem[];
  try {
    items = await paginate<SearchItem>(SEARCH_PATH, { token, fetchImpl: deps.fetchImpl });
  } catch (error) {
    if (error instanceof GitHubError) {
      const handled = await handlePollError(deps, error, { found: 0, enqueued: 0, skipped: 0 });
      if (handled) {
        return handled;
      }
    }
    throw error;
  }
  let enqueued = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      const fullName = item.repository_url.split('/repos/')[1] ?? '';
      const [owner, name] = fullName.split('/');
      if (!owner || !name) {
        skipped += 1;
        continue;
      }
      const updatedAt = Date.parse(item.updated_at);
      const localRepo = deps.db.select().from(repositories).where(eq(repositories.fullName, fullName)).get();
      const seen = localRepo
        ? deps.db.select().from(prSeen).where(and(eq(prSeen.repositoryId, localRepo.id), eq(prSeen.prNumber, item.number))).get()
        : undefined;
      if (localRepo && seen && seen.lastUpdatedAt >= updatedAt) {
        skipped += 1;
        continue;
      }

      const repoInfo = (await githubJson<RepoInfo>(`/repos/${owner}/${name}`, {
        token,
        fetchImpl: deps.fetchImpl,
        cache: { db: deps.db, key: `repo:${fullName}`, ttlMs: 300_000 },
      })).data;
      const now = (deps.now ?? Date.now)();
      deps.db.insert(repositories)
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
        .onConflictDoUpdate({ target: repositories.fullName, set: { private: repoInfo.private, archived: repoInfo.archived, updatedAt: now } })
        .run();
      const repo = deps.db.select().from(repositories).where(eq(repositories.fullName, repoInfo.full_name)).get();
      if (!repo) {
        throw new Error(`Repositório não persistido: ${repoInfo.full_name}`);
      }
      const pull = (await githubJson<PullInfo>(`/repos/${owner}/${name}/pulls/${item.number}`, {
        token,
        fetchImpl: deps.fetchImpl,
        cache: { db: deps.db, key: `pull:${fullName}:${item.number}`, ttlMs: 30_000 },
      })).data;

      const headRepo = pull.head.repo?.full_name ?? repo.fullName;

      deps.db.insert(prSeen)
        .values({ repositoryId: repo.id, prNumber: item.number, lastUpdatedAt: updatedAt, lastHeadSha: pull.head.sha, headRepo })
        .onConflictDoUpdate({
          target: [prSeen.repositoryId, prSeen.prNumber],
          set: { lastUpdatedAt: updatedAt, lastHeadSha: pull.head.sha, headRepo },
        })
        .run();

      const skipReasons: string[] = [];
      if (repo.archived) {
        skipReasons.push('arquivado');
      }
      if (!repo.enabled) {
        skipReasons.push('desabilitado');
      }
      if (settings.ignoreDrafts && pull.draft) {
        skipReasons.push('rascunho');
      }
      if (settings.skipOwnPrs && pull.user.login.toLowerCase() === credentials.login.toLowerCase()) {
        skipReasons.push('própria conta');
      }
      if (skipReasons.length > 0) {
        skipped += 1;
        emit(deps, null, 'poll.skipped', `PR ignorada: ${skipReasons.join(', ')}`, { repo: repo.fullName, pr: item.number });
        continue;
      }

      const existing = deps.db.select().from(jobs).where(and(eq(jobs.repositoryId, repo.id), eq(jobs.prNumber, item.number), eq(jobs.headSha, pull.head.sha))).get();
      if (existing) {
        skipped += 1;
        continue;
      }

      const jobId = uuidv7();
      deps.db.insert(jobs)
        .values({
          id: jobId,
          repositoryId: repo.id,
          prNumber: item.number,
          prTitle: pull.title,
          prUrl: pull.html_url,
          authorLogin: pull.user.login,
          headSha: pull.head.sha,
          baseSha: pull.base.sha,
          headRepo,
          runSeq: 1,
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
      enqueued += 1;
      emit(deps, jobId, 'job.created', `PR enfileirada: ${repo.fullName}#${item.number}`, { repo: repo.fullName, pr: item.number, headSha: pull.head.sha });
    } catch (error) {
      if (error instanceof GitHubError) {
        if (error.status === 404) {
          skipped += 1;
          continue;
        }
        const handled = await handlePollError(deps, error, { found: items.length, enqueued, skipped });
        if (handled) {
          return handled;
        }
      }
      throw error;
    }
  }

  clearPollAuthFailures(deps.db);
  emit(deps, null, 'poll.updated', `Polling concluído: ${enqueued} enfileirada(s)`, { found: items.length, enqueued, skipped });
  return { found: items.length, enqueued, skipped };
}

export async function recordPollAuthFailure(deps: PollerDeps): Promise<void> {
  const failures = (getSetting<number>(deps.db, 'poll_auth_failures') ?? 0) + 1;
  setSetting(deps.db, 'poll_auth_failures', failures);
  deps.logger.warn({ failures }, 'falha de autenticação no polling');
  if (failures >= 3) {
    setSetting(deps.db, 'poller_paused', true);
    emit(deps, null, 'poller.paused', 'Poller pausado após falhas de autenticação', { failures }, 'warn');
    try {
      await dispatchEvent({ db: deps.db, encryptionKey: deps.encryptionKey, allowPrivate: deps.allowPrivate ?? false, fetchImpl: deps.fetchImpl }, 'poller.paused', { failures });
    } catch (error) {
      deps.logger.warn({ err: error }, 'falha ao disparar webhook poller.paused');
    }
  }
}

export function clearPollAuthFailures(db: Db): void {
  setSetting(db, 'poll_auth_failures', 0);
}
