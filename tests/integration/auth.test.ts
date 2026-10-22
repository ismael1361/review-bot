import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { hashToken } from '../../src/auth/crypto';
import { sessions } from '../../src/db/schema';
import { createTestApp } from '../helpers/app';
import { ROOT_PASSWORD, setupRootAndLogin } from '../helpers/auth';

describe('autenticação', () => {
  it('faz login, retorna me e faz logout', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.username).toBe('root');
    expect(me.json().user.isRoot).toBe(true);

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(after.statusCode).toBe(401);
    await app.close();
  });

  it('rejeita credenciais inválidas', async () => {
    const { app, deps } = await createTestApp();
    await setupRootAndLogin(app, deps);
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'errada' } });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('bloqueia acesso sem sessão', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('troca de senha invalida sessões antigas', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const change = await app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: { cookie },
      payload: { currentPassword: ROOT_PASSWORD, newPassword: 'outra-senha-muito-longa' },
    });
    expect(change.statusCode).toBe(204);
    const old = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(old.statusCode).toBe(401);
    const relogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'outra-senha-muito-longa' } });
    expect(relogin.statusCode).toBe(200);
    await app.close();
  });

  it('rejeita origem cruzada em mutações', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://malicioso.com' },
      payload: { username: 'x', password: 'y' },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('limita tentativas de login', async () => {
    const { app } = await createTestApp();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'fantasma', password: 'errada' } });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    await app.close();
  });

  it('renova o cookie em requisições autenticadas', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    const setCookie = me.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    const header = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(header).toContain('prr_session=');
    expect(header.toLowerCase()).toContain('httponly');
    await app.close();
  });

  it('aplica o limite a variantes de maiúsculas do usuário', async () => {
    const { app } = await createTestApp();
    for (const username of ['root', 'ROOT', 'Root', 'rOoT', 'root']) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'errada' } });
      expect(response.statusCode).toBe(401);
    }
    const blocked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ROOT', password: 'errada' } });
    expect(blocked.statusCode).toBe(429);
    await app.close();
  });

  it('rejeita e limpa sessão expirada', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const token = cookie.slice('prr_session='.length);
    deps.db
      .update(sessions)
      .set({ absoluteExpiresAt: Date.now() - 1000 })
      .where(eq(sessions.tokenHash, hashToken(token)))
      .run();
    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(response.statusCode).toBe(401);
    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    const header = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(header).toContain('prr_session=');
    expect(header.toLowerCase()).toContain('max-age=0');
    await app.close();
  });
});
