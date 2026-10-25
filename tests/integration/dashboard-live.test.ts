import { describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';
import type { Db } from '../../src/db/client';
import { jobs, repositories, reviews } from '../../src/db/schema';
import { createWorker } from '../../src/jobs/worker';

const DAY_MS = 24 * 60 * 60 * 1000;
const REPOSITORY_ID = 'repo-dashboard';

function seedRepository(db: Db, now: number): void {
  db.insert(repositories)
    .values({
      id: REPOSITORY_ID,
      githubId: '1',
      owner: 'acme',
      name: 'app',
      fullName: 'acme/app',
      private: false,
      archived: false,
      enabled: true,
      discoveredAt: now,
      updatedAt: now,
    })
    .run();
}

function insertJob(db: Db, overrides: Partial<typeof jobs.$inferInsert> = {}): string {
  const now = Date.now();
  const id = uuidv7();
  db.insert(jobs)
    .values({
      id,
      repositoryId: REPOSITORY_ID,
      prNumber: 1,
      prTitle: 't',
      prUrl: 'u',
      authorLogin: 'x',
      headSha: uuidv7(),
      baseSha: 'b',
      runSeq: 1,
      status: 'succeeded',
      priority: 0,
      attempts: 1,
      maxAttempts: 3,
      queuedAt: now,
      ...overrides,
    })
    .run();
  return id;
}

describe('dashboard ao vivo', () => {
  it('soma tokens de vários jobs e ignora usageJson inválido ou valores inválidos', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    seedRepository(deps.db, Date.now());
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 100, output: 20 }) });
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 50, output: 5 }) });
    insertJob(deps.db, { usageJson: '{inválido' });
    insertJob(deps.db, { usageJson: JSON.stringify({ input: '50', output: -5 }) });
    insertJob(deps.db, { usageJson: JSON.stringify({ input: 30, output: -10 }) });
    insertJob(deps.db, { usageJson: 'null' });

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().tokens).toEqual({ input: 180, output: 25 });
    await app.close();
  });

  it('conta reviews nas janelas de 24h e 7 dias e ignora postedAt nulo', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    seedRepository(deps.db, now);
    const recentJob = insertJob(deps.db);
    const weekJob = insertJob(deps.db);
    const oldJob = insertJob(deps.db);
    const nullJob = insertJob(deps.db);
    deps.db.insert(reviews).values([
      { id: uuidv7(), jobId: recentJob, body: 'recente', event: 'COMMENT', status: 'posted', postedAt: now - 60 * 60 * 1000 },
      { id: uuidv7(), jobId: weekJob, body: 'semana', event: 'COMMENT', status: 'posted', postedAt: now - 3 * DAY_MS },
      { id: uuidv7(), jobId: oldJob, body: 'antiga', event: 'COMMENT', status: 'posted', postedAt: now - 8 * DAY_MS },
      { id: uuidv7(), jobId: nullJob, body: 'sem data', event: 'COMMENT', status: 'posted', postedAt: null },
    ]).run();

    const dashboard = await app.inject({ method: 'GET', url: '/api/dashboard', headers: { cookie } });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().reviews).toEqual({ total: 4, last24h: 1, last7d: 2 });
    await app.close();
  });

  it('publica job.started e job.finished no bus durante o worker', async () => {
    const { app, deps } = await createTestApp();
    const now = Date.now();
    seedRepository(deps.db, now);
    const jobId = insertJob(deps.db, { status: 'queued', attempts: 0, nextAttemptAt: now });
    const received: { type: string; data: unknown }[] = [];
    deps.bus.subscribe((event) => received.push(event));
    const worker = createWorker(
      { db: deps.db, bus: deps.bus, logger: deps.logger, encryptionKey: deps.encryptionKey, handler: async () => ({ status: 'succeeded' }) },
      'w1',
    );

    expect(await worker.tick()).toBe(true);
    expect(received.map((event) => event.type)).toEqual(['job.started', 'job.finished']);
    expect(received[0]?.data).toMatchObject({ jobId });
    expect(received[1]?.data).toMatchObject({ jobId, status: 'succeeded' });
    await app.close();
  });
});
