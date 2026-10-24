import { eq } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';
import { decryptSecret } from '../auth/crypto';
import { runAgentLoop } from '../ai/loop';
import { getProfileRow } from '../ai/profiles';
import { buildUserPrompt } from '../ai/prompt';
import type { PrFileEntry } from '../ai/tools';
import { aiProfileSkills, events, repositories, skills } from '../db/schema';
import { githubJson, paginate } from '../github/client';
import { getGithubCredentials } from '../github/credentials';
import { parseFilePatch, validRightLines, type DiffHunk } from '../github/diff';
import { publishReview } from '../github/publisher';
import { assertSafeUrl } from '../shared/url-guard';
import { dispatchEvent, type WebhookEvent } from '../webhooks/dispatcher';
import { RetryableJobError, heartbeat, isJobCancelled, type JobRow } from './queue';
import type { WorkerDeps } from './worker';

const MAX_FILES = 300;
const MAX_DIFF_BYTES = 1_000_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_EXISTING_ENTRIES = 30;

const SnapshotSchema = z.object({
  provider: z.enum(['openai_compatible', 'anthropic']),
  baseUrl: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), 'Use uma URL http(s)'),
  model: z.string().min(1).max(200),
  temperature: z.number().min(0).max(2),
  maxOutputTokens: z.number().int().min(1).max(32000),
  maxTurns: z.number().int().min(1).max(50),
  maxTotalTokens: z.number().int().min(1000).max(1000000),
  maxDurationSec: z.number().int().min(1).max(3600),
  maxFindings: z.number().int().min(1).max(50),
  maxGithubCalls: z.number().int().min(1).max(500),
  prePrompt: z.string().max(16384).default(''),
});

type Snapshot = z.infer<typeof SnapshotSchema>;

type PrFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
};

type PullMetadata = {
  title: string;
  body: string | null;
  state?: string;
  draft?: boolean;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  head: { sha: string; ref?: string; repo: { full_name: string } | null };
  base: { sha: string; ref?: string };
  user: { login: string };
};

type PrReview = {
  body: string | null;
  state?: string;
  user?: { login: string } | null;
};

type PrComment = {
  body: string;
  path: string;
  line: number | null;
  user?: { login: string } | null;
};

type PrCommit = { sha: string; commit: { message: string } };

const TEST_DIRECTORY = /(^|\/)(__tests__|tests?|specs?|e2e|fixtures?)(\/|$)/i;
const TEST_FILE = /(^|\/)(test_[^/]+|[^/]+\.(test|spec)\.[^/]+|[^/]+_test\.[^/]+)$/i;
const DOC_DIRECTORY = /(^|\/)(docs?|documentation)(\/|$)/i;
const DOC_FILE = /\.(md|mdx|rst|txt|adoc)$/i;
const DOC_NAME = /(^|\/)(readme|license|changelog|contributing)(\.[^/]+)?$/i;

function filePriority(path: string): number {
  if (DOC_DIRECTORY.test(path) || DOC_FILE.test(path) || DOC_NAME.test(path)) {
    return 2;
  }
  if (TEST_DIRECTORY.test(path) || TEST_FILE.test(path)) {
    return 1;
  }
  return 0;
}

function parseSnapshot(raw: string | null): Snapshot {
  if (!raw) {
    throw new Error('Job sem snapshot de perfil de IA (crie e ative um perfil antes)');
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Snapshot do perfil inválido: JSON inválido');
  }
  const parsed = SnapshotSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'snapshot'}: ${issue.message}`).join('; ');
    throw new Error(`Snapshot do perfil inválido: ${details}`);
  }
  return parsed.data;
}

function loadSkills(deps: WorkerDeps, profileId: string): { name: string; contentMd: string }[] {
  const rows = deps.db.select().from(aiProfileSkills).where(eq(aiProfileSkills.profileId, profileId)).all();
  return rows
    .sort((a, b) => a.position - b.position)
    .map((row) => deps.db.select().from(skills).where(eq(skills.id, row.skillId)).get())
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .map((row) => ({ name: row.name, contentMd: row.contentMd }));
}

function emitProgress(deps: WorkerDeps, jobId: string, message: string, data: Record<string, number>): void {
  const now = Date.now();
  deps.db
    .insert(events)
    .values({ id: uuidv7(), jobId, level: 'info', type: 'job.progress', message, dataJson: JSON.stringify(data), createdAt: now })
    .run();
  deps.bus.publish({ type: 'job.progress', data: { jobId, ...data }, at: now });
}

function buildFiles(
  rawFiles: PrFile[],
): { files: PrFileEntry[]; note: string; omittedFiles: number; omittedPatches: number; patchBytes: number } {
  const ordered = rawFiles
    .map((file, index) => ({ file, index, priority: filePriority(file.filename) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .slice(0, MAX_FILES)
    .map((entry) => entry.file);
  let patchBytes = 0;
  let omittedPatches = 0;
  const files = ordered.map((file): PrFileEntry => {
    let patch: string | undefined;
    if (file.patch !== undefined) {
      const bytes = Buffer.byteLength(file.patch, 'utf8');
      if (patchBytes + bytes <= MAX_DIFF_BYTES) {
        patch = file.patch;
        patchBytes += bytes;
      } else {
        omittedPatches += 1;
      }
    }
    const hunks: DiffHunk[] = patch ? parseFilePatch(patch) : [];
    return {
      path: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch,
      hunks,
    };
  });
  const omittedFiles = rawFiles.length - files.length;
  const note =
    omittedFiles > 0 || omittedPatches > 0
      ? `(diff truncado: ${omittedFiles} arquivo(s) e ${omittedPatches} patch(es) omitidos; limites de ${MAX_FILES} arquivos e ${MAX_DIFF_BYTES} bytes)`
      : '';
  return { files, note, omittedFiles, omittedPatches, patchBytes };
}

function existingEntries(reviews: PrReview[], comments: PrComment[]): string {
  const reviewLines = reviews
    .filter((review) => review.body !== null && review.body.trim().length > 0)
    .map((review) => `review de ${review.user?.login ?? 'desconhecido'}: ${review.body!.slice(0, 300)}`);
  const commentLines = comments.map(
    (comment) => `${comment.path}:${comment.line ?? '?'} (${comment.user?.login ?? 'desconhecido'}) ${comment.body.slice(0, 200)}`,
  );
  return [...reviewLines, ...commentLines].slice(0, MAX_EXISTING_ENTRIES).join('\n');
}

async function dispatchSafely(deps: WorkerDeps, event: WebhookEvent, payload: unknown): Promise<void> {
  try {
    await dispatchEvent(
      {
        db: deps.db,
        encryptionKey: deps.encryptionKey,
        allowPrivate: deps.allowPrivate ?? false,
        fetchImpl: deps.fetchImpl,
      },
      event,
      payload,
    );
  } catch (error) {
    deps.logger.warn({ err: error }, `falha ao disparar webhook ${event}`);
  }
}

export async function executeJob(job: JobRow, deps: WorkerDeps): Promise<{ status: 'succeeded' | 'partial'; usageJson: string }> {
  const startedAt = Date.now();
  const heartbeatTimer = setInterval(() => {
    try {
      heartbeat(deps.db, job.id);
    } catch (error) {
      deps.logger.warn({ err: error, jobId: job.id }, 'falha no heartbeat do job');
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  try {
    const credentials = getGithubCredentials(deps.db, deps.encryptionKey);
    if (!credentials) {
      throw new Error('Credencial GitHub ausente');
    }
    const repo = deps.db.select().from(repositories).where(eq(repositories.id, job.repositoryId)).get();
    if (!repo) {
      throw new Error('Repositório não encontrado');
    }
    if (!job.profileId) {
      throw new Error('Job sem perfil de IA (crie e ative um perfil antes)');
    }
    const snapshot = parseSnapshot(job.profileSnapshotJson);
    const profileRow = getProfileRow(deps.db, job.profileId);
    const apiKey = decryptSecret(deps.encryptionKey, profileRow.apiKeyEncrypted);
    await assertSafeUrl(snapshot.baseUrl, { allowPrivate: deps.allowPrivate ?? false, lookup: deps.lookup });

    const token = credentials.pat;
    const fetchImpl = deps.fetchImpl;
    const baseRepo = { owner: repo.owner, name: repo.name };

    const pull = (
      await githubJson<PullMetadata>(`/repos/${baseRepo.owner}/${baseRepo.name}/pulls/${job.prNumber}`, { token, fetchImpl })
    ).data;
    if (pull.head.sha !== job.headSha) {
      throw new Error(`PR desatualizada: head ${pull.head.sha} difere do SHA do job ${job.headSha}`);
    }
    const headRepoFullName = pull.head.repo?.full_name ?? repo.fullName;

    const rawFiles = await paginate<PrFile>(`/repos/${baseRepo.owner}/${baseRepo.name}/pulls/${job.prNumber}/files`, {
      token,
      fetchImpl,
      maxPages: 4,
    });
    const { files, note, omittedFiles, omittedPatches, patchBytes } = buildFiles(rawFiles);

    if (omittedFiles > 0 || omittedPatches > 0) {
      emitProgress(deps, job.id, `Diff truncado: ${omittedFiles} arquivo(s) e ${omittedPatches} patch(es) omitidos`, {
        filesTotal: rawFiles.length,
        filesIncluded: files.length,
        filesOmitted: omittedFiles,
        patchesOmitted: omittedPatches,
        patchBytes,
        maxFiles: MAX_FILES,
        maxDiffBytes: MAX_DIFF_BYTES,
      });
    }

    const [commits, reviews, comments] = await Promise.all([
      githubJson<PrCommit[]>(`/repos/${baseRepo.owner}/${baseRepo.name}/pulls/${job.prNumber}/commits?per_page=100`, {
        token,
        fetchImpl,
      }),
      githubJson<PrReview[]>(`/repos/${baseRepo.owner}/${baseRepo.name}/pulls/${job.prNumber}/reviews?per_page=100`, {
        token,
        fetchImpl,
      }),
      githubJson<PrComment[]>(`/repos/${baseRepo.owner}/${baseRepo.name}/pulls/${job.prNumber}/comments?per_page=100`, {
        token,
        fetchImpl,
      }),
    ]);

    const validLines = new Map(files.map((file) => [file.path, validRightLines(file.hunks)]));
    const fileLines = files
      .map((file) => `${file.status} ${file.path} (+${file.additions}/-${file.deletions})${file.patch ? '' : ' (patch omitido)'}`)
      .join('\n');
    const commitLine =
      commits.data.length > 0
        ? `Commits: ${commits.data.map((commit) => commit.sha.slice(0, 7)).join(', ')}`
        : 'Commits: (nenhum)';
    const filesSummary = [
      `Estado: ${pull.state ?? 'desconhecido'}${pull.draft ? ' (rascunho)' : ''}`,
      `Branches: ${pull.head.ref ?? 'desconhecida'} → ${pull.base.ref ?? 'desconhecida'}`,
      `Alterações: +${pull.additions ?? '?'}/-${pull.deletions ?? '?'} em ${pull.changed_files ?? '?'} arquivo(s)`,
      fileLines || '(nenhum arquivo)',
      commitLine,
      note,
    ]
      .filter((line) => line.length > 0)
      .join('\n');

    const userPrompt = buildUserPrompt({
      repo: repo.fullName,
      prNumber: job.prNumber,
      title: pull.title,
      body: pull.body ?? '',
      author: pull.user.login,
      headSha: job.headSha,
      filesSummary,
      existingComments: existingEntries(reviews.data, comments.data),
    });

    const loop = await runAgentLoop({
      db: deps.db,
      bus: deps.bus,
      job,
      profileSnapshot: { ...snapshot, name: profileRow.name },
      baseUrl: snapshot.baseUrl,
      apiKey,
      skills: loadSkills(deps, job.profileId),
      userPrompt,
      chatImpl: deps.chatImpl,
      fetchImpl,
      tools: {
        db: deps.db,
        job,
        token,
        fetchImpl,
        baseRepo,
        headRepoFullName,
        headSha: job.headSha,
        prNumber: job.prNumber,
        files,
        validLines,
        calls: { count: 0, max: snapshot.maxGithubCalls },
        searchCalls: { count: 0, max: 5 },
        maxFindings: snapshot.maxFindings,
      },
    });

    const usageJson = JSON.stringify({
      input: loop.usage.input,
      output: loop.usage.output,
      turns: loop.turns,
      githubCalls: loop.githubCalls,
      durationMs: Date.now() - startedAt,
    });

    if (isJobCancelled(deps.db, job.id)) {
      return { status: loop.status, usageJson };
    }

    const publish = await publishReview({ db: deps.db, token, fetchImpl }, job, loop.summary);
    if (publish.status === 'failed') {
      if (publish.retryable) {
        throw new RetryableJobError(publish.error ?? 'falha ao publicar review');
      }
      throw new Error(publish.error ?? 'falha ao publicar review');
    }

    deps.bus.publish({ type: 'review.published', data: { jobId: job.id, url: publish.url }, at: Date.now() });
    await dispatchSafely(deps, 'review.published', {
      jobId: job.id,
      repo: repo.fullName,
      pr: job.prNumber,
      url: publish.url,
      commentsPosted: publish.commentsPosted,
    });
    if (loop.status === 'partial') {
      await dispatchSafely(deps, 'job.partial', { jobId: job.id, repo: repo.fullName, pr: job.prNumber });
    }

    return { status: loop.status, usageJson };
  } finally {
    clearInterval(heartbeatTimer);
  }
}
