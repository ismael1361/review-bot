import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';
import { deleteProfile } from '../../src/ai/profiles';
import { aiProfiles, jobs, repositories, skills } from '../../src/db/schema';

const profileBody = {
  name: 'principal',
  provider: 'openai_compatible',
  baseUrl: 'https://provedor.exemplo.com/v1',
  model: 'modelo-x',
  apiKey: 'chave-secreta-123',
  skillIds: [],
};

describe('perfis de IA', () => {
  it('cria, mascara a chave, ativa e testa', async () => {
    const { app, deps } = await createTestApp();
    deps.config.ALLOW_PRIVATE_URLS = true;
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: profileBody });
    expect(created.statusCode).toBe(201);
    expect(created.json().profile.hasApiKey).toBe(true);
    expect(created.body).not.toContain('chave-secreta-123');
    const id = created.json().profile.id;

    const activated = await app.inject({ method: 'POST', url: `/api/ai-profiles/${id}/activate`, headers: { cookie } });
    expect(activated.json().profile.isActive).toBe(true);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const tested = await app.inject({ method: 'POST', url: `/api/ai-profiles/${id}/test`, headers: { cookie }, payload: {} });
    expect(tested.json()).toEqual({ ok: true });
    vi.unstubAllGlobals();
    await app.close();
  });

  it('mantém a chave quando o update não envia apiKey', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: profileBody });
    const id = created.json().profile.id;
    const updated = await app.inject({ method: 'PUT', url: `/api/ai-profiles/${id}`, headers: { cookie }, payload: { ...profileBody, name: 'renomeado', apiKey: undefined } });
    expect(updated.json().profile.name).toBe('renomeado');
    expect(updated.json().profile.hasApiKey).toBe(true);
    await app.close();
  });

  it('não remove o perfil ativo', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: profileBody });
    const id = created.json().profile.id;
    await app.inject({ method: 'POST', url: `/api/ai-profiles/${id}/activate`, headers: { cookie } });
    const removed = await app.inject({ method: 'DELETE', url: `/api/ai-profiles/${id}`, headers: { cookie } });
    expect(removed.statusCode).toBe(409);
    expect(removed.json().error.code).toBe('active_profile');
    await app.close();
  });

  it('remove o perfil e mantém jobs com profileId nulo', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: profileBody });
    const profileId = created.json().profile.id;
    const now = Date.now();
    deps.db.insert(repositories).values({
      id: 'repo-1',
      githubId: '1',
      owner: 'dono',
      name: 'repo',
      fullName: 'dono/repo',
      discoveredAt: now,
      updatedAt: now,
    }).run();
    deps.db.insert(jobs).values({
      id: 'job-1',
      repositoryId: 'repo-1',
      prNumber: 1,
      prTitle: 'PR de teste',
      prUrl: 'https://github.com/dono/repo/pull/1',
      authorLogin: 'autor',
      headSha: 'abc123',
      baseSha: 'def456',
      status: 'queued',
      profileId,
      queuedAt: now,
    }).run();

    deleteProfile(deps.db, profileId);

    expect(deps.db.select().from(aiProfiles).where(eq(aiProfiles.id, profileId)).get()).toBeUndefined();
    const job = deps.db.select().from(jobs).where(eq(jobs.id, 'job-1')).get();
    expect(job).toBeDefined();
    expect(job?.profileId).toBeNull();
    await app.close();
  });

  it('valida limites', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const response = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: { ...profileBody, temperature: 5 } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('rejeita baseUrl que não seja http(s)', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const response = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: { ...profileBody, baseUrl: 'ftp://exemplo.com' } });
    expect(response.statusCode).toBe(400);
    expect(deps.db.select().from(aiProfiles).all()).toHaveLength(0);
    await app.close();
  });

  it('rejeita skillIds duplicados', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const now = Date.now();
    deps.db.insert(skills).values({ id: 's1', name: 'skill um', description: '', contentMd: 'conteúdo', createdAt: now, updatedAt: now }).run();
    const response = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: { ...profileBody, skillIds: ['s1', 's1'] } });
    expect(response.statusCode).toBe(400);
    expect(deps.db.select().from(aiProfiles).all()).toHaveLength(0);
    await app.close();
  });

  it('rejeita skill desconhecida sem criar perfil', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const response = await app.inject({ method: 'POST', url: '/api/ai-profiles', headers: { cookie }, payload: { ...profileBody, skillIds: ['nao-existe'] } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('skill_not_found');
    expect(deps.db.select().from(aiProfiles).all()).toHaveLength(0);
    await app.close();
  });

  it('bloqueia teste contra endereço privado quando allowPrivate é false', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai-profiles',
      headers: { cookie },
      payload: { ...profileBody, baseUrl: 'http://127.0.0.1:11434' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().profile.id;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const tested = await app.inject({ method: 'POST', url: `/api/ai-profiles/${id}/test`, headers: { cookie }, payload: {} });
    expect(tested.statusCode).toBe(400);
    expect(tested.json().error.code).toBe('invalid_base_url');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    await app.close();
  });

  it('permite teste contra endereço privado quando allowPrivate é true', async () => {
    const { app, deps } = await createTestApp();
    deps.config.ALLOW_PRIVATE_URLS = true;
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({
      method: 'POST',
      url: '/api/ai-profiles',
      headers: { cookie },
      payload: { ...profileBody, baseUrl: 'http://127.0.0.1:11434' },
    });
    const id = created.json().profile.id;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const tested = await app.inject({ method: 'POST', url: `/api/ai-profiles/${id}/test`, headers: { cookie }, payload: {} });
    expect(tested.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    await app.close();
  });
});
