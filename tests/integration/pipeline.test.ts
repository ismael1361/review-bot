import { describe, expect, it } from 'vitest';
import { activateProfile, createProfile } from '../../src/ai/profiles';
import { jobs, prSeen, reviews } from '../../src/db/schema';
import { saveGithubCredentials } from '../../src/github/credentials';
import { pollOnce } from '../../src/github/poller';
import { executeJob } from '../../src/jobs/execute';
import { createWorker } from '../../src/jobs/worker';
import { createTestApp } from '../helpers/app';
import { createFakeGithub } from '../helpers/fake-github';
import { createScriptedChat, toolCall } from '../helpers/fake-provider';

const PUBLIC_LOOKUP = async () => ['93.184.216.34'];
const SUMMARY = 'Review técnico da PR #7 com um achado crítico.';

async function setup() {
  const { app, deps } = await createTestApp();
  await app.close();
  saveGithubCredentials(deps.db, deps.encryptionKey, { login: 'bot', pat: 'ghp_1234567890abcdefghij', scopes: 'repo' });
  const profile = createProfile(deps.db, deps.encryptionKey, {
    name: 'p1',
    provider: 'openai_compatible',
    baseUrl: 'https://p.exemplo.com/v1',
    model: 'm',
    apiKey: 'k',
    temperature: 0.2,
    maxOutputTokens: 4096,
    maxTurns: 10,
    maxTotalTokens: 100000,
    maxDurationSec: 600,
    maxFindings: 25,
    maxGithubCalls: 80,
    prePrompt: '',
    skillIds: [],
  });
  activateProfile(deps.db, profile.id);
  return deps;
}

describe('pipeline ponta a ponta', () => {
  it('detecta, analisa, publica e não duplica', async () => {
    const deps = await setup();
    const github = createFakeGithub();

    const poll = await pollOnce({
      db: deps.db,
      bus: deps.bus,
      logger: deps.logger,
      encryptionKey: deps.encryptionKey,
      fetchImpl: github.fetchImpl,
    });
    expect(poll).toEqual({ found: 1, enqueued: 1, skipped: 0 });
    expect(deps.db.select().from(jobs).get()!.status).toBe('queued');

    const chatImpl = createScriptedChat([
      toolCall('get_pr_files', {}),
      toolCall('add_finding', { path: 'src/a.ts', line: 41, severity: 'critical', title: 'Bug de sessão', body: 'corpo' }),
      toolCall('submit_review', { summary: SUMMARY }),
    ]);
    const worker = createWorker(
      {
        db: deps.db,
        bus: deps.bus,
        logger: deps.logger,
        encryptionKey: deps.encryptionKey,
        fetchImpl: github.fetchImpl,
        chatImpl,
        handler: executeJob,
        lookup: PUBLIC_LOOKUP,
      },
      'w1',
    );
    expect(await worker.tick()).toBe(true);

    const job = deps.db.select().from(jobs).get()!;
    expect(job.status).toBe('succeeded');
    expect(job.errorMessage).toBeNull();
    expect(job.headSha).toBe('sha1');
    expect(job.summaryMd).toBe(SUMMARY);
    expect(job.usageJson).not.toBeNull();

    expect(github.state.posts).toHaveLength(1);
    const post = github.state.posts[0]!;
    expect(post.body).toContain(`<!-- pr-reviewer:job:${job.id} -->`);
    expect(post.body).toContain(SUMMARY);
    expect(post.commit_id).toBe('sha1');
    expect(post.comments).toHaveLength(1);
    expect(post.comments![0]).toMatchObject({ path: 'src/a.ts', line: 41 });
    expect(post.comments![0]!.body).toContain('[CRÍTICO] Bug de sessão');
    expect(post.comments![0]!.body).toContain('corpo');

    const reviewRows = deps.db.select().from(reviews).all();
    expect(reviewRows).toHaveLength(1);
    expect(reviewRows[0]!.status).toBe('posted');
    expect(reviewRows[0]!.commentsPosted).toBe(1);
    expect(reviewRows[0]!.body).toContain(SUMMARY);

    const second = await pollOnce({
      db: deps.db,
      bus: deps.bus,
      logger: deps.logger,
      encryptionKey: deps.encryptionKey,
      fetchImpl: github.fetchImpl,
    });
    expect(second).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    expect(deps.db.select().from(jobs).all()).toHaveLength(1);
    expect(github.state.posts).toHaveLength(1);
  });

  it('novo commit gera novo job', async () => {
    const deps = await setup();
    const github = createFakeGithub();

    const first = await pollOnce({
      db: deps.db,
      bus: deps.bus,
      logger: deps.logger,
      encryptionKey: deps.encryptionKey,
      fetchImpl: github.fetchImpl,
    });
    expect(first).toEqual({ found: 1, enqueued: 1, skipped: 0 });
    const firstJob = deps.db.select().from(jobs).get()!;
    expect(firstJob.headSha).toBe('sha1');

    github.state.headSha = 'sha2';
    github.state.updatedAt = '2026-10-22T15:00:00Z';

    const second = await pollOnce({
      db: deps.db,
      bus: deps.bus,
      logger: deps.logger,
      encryptionKey: deps.encryptionKey,
      fetchImpl: github.fetchImpl,
    });
    expect(second).toEqual({ found: 1, enqueued: 1, skipped: 0 });

    const allJobs = deps.db.select().from(jobs).all();
    expect(allJobs).toHaveLength(2);
    expect(allJobs.map((row) => row.headSha).sort()).toEqual(['sha1', 'sha2']);
    expect(allJobs.every((row) => row.status === 'queued')).toBe(true);

    const seen = deps.db.select().from(prSeen).get()!;
    expect(seen.lastHeadSha).toBe('sha2');
    expect(seen.lastUpdatedAt).toBe(Date.parse(github.state.updatedAt));
  });
});
