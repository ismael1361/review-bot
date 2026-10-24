import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

function fakeGithub(login: string, status = 200, scopes = 'repo') {
  return vi.fn(async () =>
    new Response(JSON.stringify(status === 200 ? { login } : { message: 'Bad credentials' }), {
      status,
      headers: { 'content-type': 'application/json', 'x-oauth-scopes': scopes },
    }),
  ) as unknown as typeof fetch;
}

describe('credencial GitHub', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('salva credencial validada e mascara o token', async () => {
    vi.stubGlobal('fetch', fakeGithub('octocat'));
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const save = await app.inject({ method: 'PUT', url: '/api/settings/github', headers: { cookie }, payload: { pat: 'ghp_1234567890abcdefghij' } });
    expect(save.statusCode).toBe(200);
    expect(save.json().credentials).toEqual({ login: 'octocat', patLast4: 'ghij', scopes: 'repo' });
    expect(save.body).not.toContain('ghp_1234567890abcdefghij');
    await app.close();
  });

  it('rejeita token inválido', async () => {
    vi.stubGlobal('fetch', fakeGithub('', 401));
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const save = await app.inject({ method: 'PUT', url: '/api/settings/github', headers: { cookie }, payload: { pat: 'ghp_invalido_invalido_invalido' } });
    expect(save.statusCode).toBe(400);
    expect(save.json().error.code).toBe('invalid_github_token');
    await app.close();
  });

  it('trata indisponibilidade do GitHub como 502', async () => {
    vi.stubGlobal('fetch', fakeGithub('', 500));
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const save = await app.inject({ method: 'PUT', url: '/api/settings/github', headers: { cookie }, payload: { pat: 'ghp_1234567890abcdefghij' } });
    expect(save.statusCode).toBe(502);
    expect(save.json().error.code).toBe('github_unavailable');
    await app.close();
  });

  it('trata falha de rede como 502', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch);
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const save = await app.inject({ method: 'PUT', url: '/api/settings/github', headers: { cookie }, payload: { pat: 'ghp_1234567890abcdefghij' } });
    expect(save.statusCode).toBe(502);
    expect(save.json().error.code).toBe('github_unavailable');
    await app.close();
  });

  it('testa usando o token salvo quando não enviado', async () => {
    vi.stubGlobal('fetch', fakeGithub('octocat'));
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await app.inject({ method: 'PUT', url: '/api/settings/github', headers: { cookie }, payload: { pat: 'ghp_1234567890abcdefghij' } });
    const test = await app.inject({ method: 'POST', url: '/api/settings/github/test', headers: { cookie }, payload: {} });
    expect(test.json()).toEqual({ ok: true, login: 'octocat', scopes: 'repo' });
    await app.close();
  });
});
