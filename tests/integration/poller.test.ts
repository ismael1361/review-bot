import { and, eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';
import { activateProfile, createProfile } from '../../src/ai/profiles';
import type { AppDeps } from '../../src/api/app';
import { encryptSecret } from '../../src/auth/crypto';
import { events, jobs, prSeen, repositories, webhookDeliveries, webhooks } from '../../src/db/schema';
import { getSetting, setSetting } from '../../src/db/settings';
import type { BusEvent } from '../../src/events/bus';
import { saveGithubCredentials } from '../../src/github/credentials';
import { pollOnce, type PollerDeps } from '../../src/github/poller';

const TOKEN = 'ghp_1234567890abcdefghij';
const NOW = Date.parse('2026-10-22T15:00:00Z');

const searchItem = { number: 482, repository_url: 'https://api.github.com/repos/acme/api', updated_at: '2026-10-22T14:00:00Z' };
const repoInfo = { id: 1, full_name: 'acme/api', archived: false, private: true };
const pullInfo = {
  title: 'fix: valida token',
  html_url: 'https://github.com/acme/api/pull/482',
  draft: false,
  head: { sha: '9f2c1ab', repo: { full_name: 'acme/api' } },
  base: { sha: 'aaaaaaa' },
  user: { login: 'octocat' },
};

type Route = { match: string; body?: unknown; status?: number; headers?: Record<string, string> };

function fakeFetch(routes: Route[]): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const route of routes) {
      if (url.includes(route.match)) {
        return new Response(JSON.stringify(route.body ?? {}), { status: route.status ?? 200, headers: { 'content-type': 'application/json', ...route.headers } });
      }
    }
    return new Response('{}', { status: 404 });
  });
  return { fetchImpl: mock as unknown as typeof fetch, calls };
}

function githubRoutes(options: { search?: unknown; repo?: unknown; pull?: unknown; searchStatus?: number; repoStatus?: number; pullStatus?: number } = {}): Route[] {
  return [
    { match: '/search/issues', body: options.search ?? { items: [searchItem] }, status: options.searchStatus },
    { match: '/repos/acme/api/pulls/482', body: options.pull ?? pullInfo, status: options.pullStatus },
    { match: '/repos/acme/api', body: options.repo ?? repoInfo, status: options.repoStatus },
  ];
}

function pollerDeps(deps: AppDeps, fetchImpl: typeof fetch): PollerDeps {
  return { ...deps, fetchImpl, now: () => NOW };
}

async function depsWithSetup(profileState: 'active' | 'inactive' | 'none' = 'active', withCredentials = true) {
  const { app, deps } = await createTestApp();
  await setupRootAndLogin(app, deps);
  if (withCredentials) {
    saveGithubCredentials(deps.db, deps.encryptionKey, { login: 'bot', pat: TOKEN, scopes: 'repo' });
  }
  let profileId: string | undefined;
  if (profileState !== 'none') {
    const profile = createProfile(deps.db, deps.encryptionKey, {
      name: 'p1',
      provider: 'openai_compatible',
      baseUrl: 'https://p.exemplo.com/v1',
      model: 'm',
      apiKey: 'k',
      temperature: 0.2,
      maxOutputTokens: 4096,
      maxTurns: 20,
      maxTotalTokens: 200000,
      maxDurationSec: 600,
      maxFindings: 25,
      maxGithubCalls: 80,
      prePrompt: '',
      skillIds: [],
    });
    profileId = profile.id;
    if (profileState === 'active') {
      activateProfile(deps.db, profile.id);
    }
  }
  await app.close();
  return { deps, profileId };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('poller', () => {
  it('enfileira PR nova com perfil e ignora na segunda passada', async () => {
    const { deps, profileId } = await depsWithSetup();
    const { fetchImpl, calls } = fakeFetch(githubRoutes());
    const busEvents: BusEvent[] = [];
    const unsubscribe = deps.bus.subscribe((event) => busEvents.push(event));

    const first = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(first).toEqual({ found: 1, enqueued: 1, skipped: 0 });

    const rows = deps.db.select().from(jobs).all();
    expect(rows).toHaveLength(1);
    const job = rows[0]!;
    expect(job.status).toBe('queued');
    expect(job.runSeq).toBe(1);
    expect(job.profileId).toBe(profileId);
    expect(job.profileSnapshotJson).not.toBeNull();
    expect(JSON.parse(job.profileSnapshotJson!)).toMatchObject({ id: profileId, name: 'p1', provider: 'openai_compatible', model: 'm' });
    expect(job.headRepo).toBe('acme/api');
    const repo = deps.db.select().from(repositories).where(eq(repositories.fullName, 'acme/api')).get()!;
    const seen = deps.db.select().from(prSeen).where(and(eq(prSeen.repositoryId, repo.id), eq(prSeen.prNumber, 482))).get()!;
    expect(seen.headRepo).toBe('acme/api');
    expect(busEvents.some((event) => event.type === 'job.created')).toBe(true);

    const callsAfterFirst = calls.length;
    const second = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(second).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    expect(calls).toHaveLength(callsAfterFirst + 1);
    expect(calls[calls.length - 1]).toContain('/search/issues');
    unsubscribe();
  });

  it('persiste e atualiza o repositório head do fork', async () => {
    const { deps } = await depsWithSetup();
    const forkPull = { ...pullInfo, head: { sha: '9f2c1ab', repo: { full_name: 'fork/api' } } };
    const firstFetch = fakeFetch(githubRoutes({ pull: forkPull }));

    const first = await pollOnce(pollerDeps(deps, firstFetch.fetchImpl));
    expect(first).toEqual({ found: 1, enqueued: 1, skipped: 0 });
    const job = deps.db.select().from(jobs).get()!;
    expect(job.headRepo).toBe('fork/api');
    const repo = deps.db.select().from(repositories).where(eq(repositories.fullName, 'acme/api')).get()!;
    const seen = deps.db.select().from(prSeen).where(and(eq(prSeen.repositoryId, repo.id), eq(prSeen.prNumber, 482))).get()!;
    expect(seen.headRepo).toBe('fork/api');

    const nextPull = { ...pullInfo, head: { sha: '9f2c1ab', repo: { full_name: 'fork2/api' } } };
    const secondFetch = fakeFetch(githubRoutes({ search: { items: [{ ...searchItem, updated_at: '2026-10-22T15:00:00Z' }] }, pull: nextPull }));
    const second = await pollOnce(pollerDeps(deps, secondFetch.fetchImpl));
    expect(second).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    const updatedSeen = deps.db.select().from(prSeen).where(and(eq(prSeen.repositoryId, repo.id), eq(prSeen.prNumber, 482))).get()!;
    expect(updatedSeen.headRepo).toBe('fork2/api');
    expect(deps.db.select().from(jobs).all()).toHaveLength(1);
  });

  it('ignora repositório arquivado e persiste pr_seen', async () => {
    const { deps } = await depsWithSetup();
    const { fetchImpl, calls } = fakeFetch(githubRoutes({ repo: { ...repoInfo, archived: true } }));

    const first = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(first).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    const repo = deps.db.select().from(repositories).where(eq(repositories.fullName, 'acme/api')).get();
    expect(repo).toBeDefined();
    const seen = deps.db.select().from(prSeen).where(and(eq(prSeen.repositoryId, repo!.id), eq(prSeen.prNumber, 482))).get();
    expect(seen?.lastUpdatedAt).toBe(Date.parse(searchItem.updated_at));
    expect(seen?.lastHeadSha).toBe(pullInfo.head.sha);
    const skippedEvent = deps.db.select().from(events).where(eq(events.type, 'poll.skipped')).get();
    expect(skippedEvent?.message).toContain('arquivado');

    const callsAfterFirst = calls.length;
    const second = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(second).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    expect(calls).toHaveLength(callsAfterFirst + 1);
    expect(calls[calls.length - 1]).toContain('/search/issues');
  });

  it('ignora PR da própria conta e persiste pr_seen', async () => {
    const { deps } = await depsWithSetup();
    const { fetchImpl, calls } = fakeFetch(githubRoutes({ pull: { ...pullInfo, user: { login: 'bot' } } }));

    const first = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(first).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    const repo = deps.db.select().from(repositories).where(eq(repositories.fullName, 'acme/api')).get();
    const seen = deps.db.select().from(prSeen).where(and(eq(prSeen.repositoryId, repo!.id), eq(prSeen.prNumber, 482))).get();
    expect(seen).toBeDefined();
    const skippedEvent = deps.db.select().from(events).where(eq(events.type, 'poll.skipped')).get();
    expect(skippedEvent?.message).toContain('própria conta');

    const callsAfterFirst = calls.length;
    const second = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(second).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    expect(calls).toHaveLength(callsAfterFirst + 1);
    expect(calls[calls.length - 1]).toContain('/search/issues');
  });

  it('ignora repositório desabilitado sem reativá-lo', async () => {
    const { deps } = await depsWithSetup();
    deps.db.insert(repositories).values({
      id: 'repo-existente',
      githubId: '1',
      owner: 'acme',
      name: 'api',
      fullName: 'acme/api',
      private: true,
      archived: false,
      enabled: false,
      discoveredAt: NOW,
      updatedAt: NOW,
    }).run();
    const { fetchImpl } = fakeFetch(githubRoutes());

    const result = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(result).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    const repo = deps.db.select().from(repositories).where(eq(repositories.fullName, 'acme/api')).get();
    expect(repo?.enabled).toBe(false);
    const skippedEvent = deps.db.select().from(events).where(eq(events.type, 'poll.skipped')).get();
    expect(skippedEvent?.message).toContain('desabilitado');
  });

  it('não chama a API sem perfil ativo e registra aviso', async () => {
    const { deps } = await depsWithSetup('inactive');
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(result).toEqual({ found: 0, enqueued: 0, skipped: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const warning = deps.db.select().from(events).where(and(eq(events.type, 'poll.updated'), eq(events.level, 'warn'))).get();
    expect(warning?.message).toContain('perfil');
  });

  it('não exige credenciais GitHub quando não há perfil ativo', async () => {
    const { deps } = await depsWithSetup('none', false);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(result).toEqual({ found: 0, enqueued: 0, skipped: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const warning = deps.db.select().from(events).where(and(eq(events.type, 'poll.updated'), eq(events.level, 'warn'))).get();
    expect(warning?.message).toContain('perfil');
  });

  it('não chama a API quando o poller está pausado', async () => {
    const { deps } = await depsWithSetup();
    setSetting(deps.db, 'poller_paused', true);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(result).toEqual({ found: 0, enqueued: 0, skipped: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('não chama a API quando a fila está pausada', async () => {
    const { deps } = await depsWithSetup();
    setSetting(deps.db, 'queue_paused', true);
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const result = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(result).toEqual({ found: 0, enqueued: 0, skipped: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pausa após três falhas de autenticação consecutivas', async () => {
    const { deps } = await depsWithSetup();
    const { fetchImpl, calls } = fakeFetch([{ match: '/search/issues', body: { message: 'Bad credentials' }, status: 401 }]);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const result = await pollOnce(pollerDeps(deps, fetchImpl));
      expect(result).toEqual({ found: 0, enqueued: 0, skipped: 0 });
      expect(getSetting<number>(deps.db, 'poll_auth_failures')).toBe(attempt);
    }
    expect(getSetting<boolean>(deps.db, 'poller_paused')).toBe(true);
    const pausedEvent = deps.db.select().from(events).where(eq(events.type, 'poller.paused')).get();
    expect(pausedEvent).toBeDefined();

    const callsBefore = calls.length;
    const afterPause = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(afterPause).toEqual({ found: 0, enqueued: 0, skipped: 0 });
    expect(calls).toHaveLength(callsBefore);
  });

  it('trata 403 de rate limit como falha temporária sem pausar o poller', async () => {
    const { deps } = await depsWithSetup();
    const { fetchImpl } = fakeFetch([{ match: '/search/issues', body: { message: 'rate limit' }, status: 403, headers: { 'x-ratelimit-remaining': '0' } }]);

    const result = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(result).toEqual({ found: 0, enqueued: 0, skipped: 0 });
    const warning = deps.db.select().from(events).where(and(eq(events.type, 'poll.updated'), eq(events.level, 'warn'))).get();
    expect(warning?.message).toContain('Falha temporária');
    expect(getSetting<number>(deps.db, 'poll_auth_failures')).toBe(0);
    expect(getSetting<boolean>(deps.db, 'poller_paused')).toBe(false);
  });

  it('dispara webhook poller.paused após três falhas de autenticação', async () => {
    const { deps } = await depsWithSetup();
    deps.db.insert(webhooks).values({
      id: 'wh-paused',
      url: 'https://93.184.216.34/hook',
      secretEncrypted: encryptSecret(deps.encryptionKey, 'segredo'),
      eventsJson: JSON.stringify(['poller.paused']),
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    }).run();
    const { fetchImpl } = fakeFetch([
      { match: '/search/issues', body: { message: 'Bad credentials' }, status: 401 },
      { match: 'https://93.184.216.34/hook', status: 200 },
    ]);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await pollOnce(pollerDeps(deps, fetchImpl));
    }
    expect(getSetting<boolean>(deps.db, 'poller_paused')).toBe(true);
    const delivery = deps.db.select().from(webhookDeliveries).where(and(eq(webhookDeliveries.event, 'poller.paused'), eq(webhookDeliveries.success, true))).get();
    expect(delivery).toBeDefined();
    expect(delivery?.statusCode).toBe(200);
  });

  it('zera o contador de falhas após um poll bem-sucedido', async () => {
    const { deps } = await depsWithSetup();
    const unauthorized = fakeFetch([{ match: '/search/issues', body: { message: 'Bad credentials' }, status: 401 }]);
    await pollOnce(pollerDeps(deps, unauthorized.fetchImpl));
    await pollOnce(pollerDeps(deps, unauthorized.fetchImpl));
    expect(getSetting<number>(deps.db, 'poll_auth_failures')).toBe(2);

    const { fetchImpl } = fakeFetch(githubRoutes());
    await pollOnce(pollerDeps(deps, fetchImpl));
    expect(getSetting<number>(deps.db, 'poll_auth_failures')).toBe(0);
    expect(getSetting<boolean>(deps.db, 'poller_paused')).toBe(false);
  });

  it('registra aviso e não lança em erro temporário no search', async () => {
    const { deps } = await depsWithSetup();
    const { fetchImpl } = fakeFetch([{ match: '/search/issues', body: { message: 'boom' }, status: 500 }]);

    const result = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(result).toEqual({ found: 0, enqueued: 0, skipped: 0 });
    const warning = deps.db.select().from(events).where(and(eq(events.type, 'poll.updated'), eq(events.level, 'warn'))).get();
    expect(warning?.message).toContain('Falha temporária');
    expect(deps.db.select().from(jobs).all()).toHaveLength(0);
    expect(getSetting<number>(deps.db, 'poll_auth_failures')).toBe(0);
  });

  it('conta como ignorado quando o repositório responde 404', async () => {
    const { deps } = await depsWithSetup();
    const { fetchImpl } = fakeFetch([{ match: '/search/issues', body: { items: [searchItem] } }, { match: '/repos/acme/api', status: 404 }]);

    const result = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(result).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    expect(deps.db.select().from(jobs).all()).toHaveLength(0);
  });

  it('conta como ignorado quando o PR responde 404', async () => {
    const { deps } = await depsWithSetup();
    const { fetchImpl } = fakeFetch(githubRoutes({ pullStatus: 404 }));

    const result = await pollOnce(pollerDeps(deps, fetchImpl));
    expect(result).toEqual({ found: 1, enqueued: 0, skipped: 1 });
    expect(deps.db.select().from(jobs).all()).toHaveLength(0);
  });
});
