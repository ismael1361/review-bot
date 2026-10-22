import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

async function createUser(app: Awaited<ReturnType<typeof createTestApp>>['app'], cookie: string, role: string, username: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie },
    payload: { username, password: 'senha-muito-segura', role },
  });
  return response;
}

describe('usuários', () => {
  it('cria, lista e altera papel', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await createUser(app, cookie, 'viewer', 'ana');
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(list.json().users).toHaveLength(2);
    const id = created.json().user.id;
    const patched = await app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: { cookie }, payload: { role: 'operator' } });
    expect(patched.json().user.role).toBe('operator');
    await app.close();
  });

  it('impede root de criar admin sem ser root', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await createUser(app, cookie, 'admin', 'adm');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'adm', password: 'senha-muito-segura' } });
    const admCookie = `prr_session=${login.cookies.find((c) => c.name === 'prr_session')!.value}`;
    const response = await createUser(app, admCookie, 'admin', 'adm2');
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('protege o último administrador ativo', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await createUser(app, cookie, 'admin', 'adm');
    const id = created.json().user.id;
    const response = await app.inject({ method: 'PATCH', url: `/api/users/${id}`, headers: { cookie }, payload: { disabled: true } });
    expect(response.statusCode).toBe(409);
    await app.close();
  });

  it('não altera o root', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const list = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    const root = list.json().users.find((u: { isRoot: boolean }) => u.isRoot);
    const response = await app.inject({ method: 'PATCH', url: `/api/users/${root.id}`, headers: { cookie }, payload: { disabled: true } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('viewer não acessa a lista', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await createUser(app, cookie, 'viewer', 'ana');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ana', password: 'senha-muito-segura' } });
    const viewerCookie = `prr_session=${login.cookies.find((c) => c.name === 'prr_session')!.value}`;
    const response = await app.inject({ method: 'GET', url: '/api/users', headers: { cookie: viewerCookie } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
