import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { auditLog } from '../../src/db/schema';
import { getSetting } from '../../src/db/settings';
import { applyInstanceSettings, effectiveTrustProxy } from '../../src/instance/settings';
import { createTestApp } from '../helpers/app';
import { ROOT_PASSWORD, setupRootAndLogin } from '../helpers/auth';

describe('configurações da instância', () => {
  it('admin salva publicUrl/trustProxy/allowPrivateUrls e lê de volta', async () => {
    const { app, deps } = await createTestApp();
    const admin = await setupRootAndLogin(app, deps);
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/settings/instance',
      headers: { cookie: admin },
      payload: { publicUrl: 'https://reviews.example.com', trustProxy: true, allowPrivateUrls: false },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings.publicUrl).toBe('https://reviews.example.com');
    expect(saved.json().restartRequired).toBe(true);
    expect(getSetting(deps.db, 'instance')).toMatchObject({ publicUrl: 'https://reviews.example.com', trustProxy: true });
    const got = await app.inject({ method: 'GET', url: '/api/settings/instance', headers: { cookie: admin } });
    expect(got.statusCode).toBe(200);
    expect(got.json().settings.trustProxy).toBe(true);
    expect(got.json().restartRequired).toBe(true);
    const audited = deps.db.select().from(auditLog).where(eq(auditLog.action, 'instance_settings.update')).get();
    expect(audited).toBeTruthy();
    await app.close();
  });

  it('mantém o reinício pendente ao salvar outra configuração e limpa ao voltar ao valor de boot', async () => {
    const { app, deps } = await createTestApp();
    const admin = await setupRootAndLogin(app, deps);
    const enabled = await app.inject({
      method: 'PUT',
      url: '/api/settings/instance',
      headers: { cookie: admin },
      payload: { trustProxy: true },
    });
    expect(enabled.json().restartRequired).toBe(true);

    const other = await app.inject({
      method: 'PUT',
      url: '/api/settings/instance',
      headers: { cookie: admin },
      payload: { publicUrl: 'https://outra.example.com', trustProxy: true, allowPrivateUrls: true },
    });
    expect(other.json().restartRequired).toBe(true);
    const pending = await app.inject({ method: 'GET', url: '/api/settings/instance', headers: { cookie: admin } });
    expect(pending.json().restartRequired).toBe(true);

    const toggledBack = await app.inject({
      method: 'PUT',
      url: '/api/settings/instance',
      headers: { cookie: admin },
      payload: { publicUrl: 'https://outra.example.com', trustProxy: false, allowPrivateUrls: true },
    });
    expect(toggledBack.json().restartRequired).toBe(false);
    const cleared = await app.inject({ method: 'GET', url: '/api/settings/instance', headers: { cookie: admin } });
    expect(cleared.json().restartRequired).toBe(false);
    await app.close();
  });

  it('viewer recebe 403 ao ler e ao salvar', async () => {
    const { app, deps } = await createTestApp();
    const admin = await setupRootAndLogin(app, deps);
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin },
      payload: { username: 'viewer', password: ROOT_PASSWORD, role: 'viewer' },
    });
    expect(created.statusCode).toBe(201);
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'viewer', password: ROOT_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies.find((item) => item.name === 'prr_session');
    expect(cookie).toBeTruthy();
    const viewerCookie = `prr_session=${cookie!.value}`;
    const got = await app.inject({ method: 'GET', url: '/api/settings/instance', headers: { cookie: viewerCookie } });
    expect(got.statusCode).toBe(403);
    const saved = await app.inject({
      method: 'PUT',
      url: '/api/settings/instance',
      headers: { cookie: viewerCookie },
      payload: { trustProxy: true },
    });
    expect(saved.statusCode).toBe(403);
    await app.close();
  });

  it('não força PUBLIC_URL quando env e banco não informam', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    const outcome = applyInstanceSettings(config, { trustProxy: false, allowPrivateUrls: false }, {});
    expect(config.PUBLIC_URL).toBeUndefined();
    expect(outcome.trustProxyChanged).toBe(false);
  });

  it('aplica env com precedência e trata vazio como ausente', () => {
    const config = loadConfig({ NODE_ENV: 'test', PUBLIC_URL: 'http://env.example', TRUST_PROXY: 'false', ALLOW_PRIVATE_URLS: 'false' });
    const fromStored = applyInstanceSettings(
      config,
      { publicUrl: 'https://stored.example', trustProxy: true, allowPrivateUrls: true },
      { PUBLIC_URL: '', TRUST_PROXY: '', ALLOW_PRIVATE_URLS: '' },
    );
    expect(config.PUBLIC_URL).toBe('https://stored.example');
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.ALLOW_PRIVATE_URLS).toBe(true);
    expect(fromStored.trustProxyChanged).toBe(true);
    expect(effectiveTrustProxy({ trustProxy: true, allowPrivateUrls: true }, { TRUST_PROXY: '' })).toBe(true);

    const fromEnv = applyInstanceSettings(
      config,
      { trustProxy: true, allowPrivateUrls: true },
      { PUBLIC_URL: 'https://env.example', TRUST_PROXY: 'false', ALLOW_PRIVATE_URLS: 'false' },
    );
    expect(config.PUBLIC_URL).toBe('https://env.example');
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.ALLOW_PRIVATE_URLS).toBe(false);
    expect(fromEnv.trustProxyChanged).toBe(false);
    expect(effectiveTrustProxy({ trustProxy: true, allowPrivateUrls: true }, { TRUST_PROXY: 'false' })).toBe(false);
  });
});
