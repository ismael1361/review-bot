import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog } from '../../src/db/schema';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

async function createUser(app: Awaited<ReturnType<typeof createTestApp>>['app'], cookie: string, username: string, role: string) {
  return app.inject({
    method: 'POST',
    url: '/api/users',
    headers: { cookie },
    payload: { username, password: 'senha-muito-segura', role },
  });
}

describe('auditoria', () => {
  it('viewer recebe 403', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await createUser(app, cookie, 'ana', 'viewer');
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ana', password: 'senha-muito-segura' } });
    const viewerCookie = `prr_session=${login.cookies.find((c) => c.name === 'prr_session')!.value}`;
    const response = await app.inject({ method: 'GET', url: '/api/audit', headers: { cookie: viewerCookie } });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('admin lista entradas paginadas com total', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const ana = await createUser(app, cookie, 'ana', 'viewer');
    const bruno = await createUser(app, cookie, 'bruno', 'operator');
    deps.db.update(auditLog).set({ createdAt: 1000 }).where(eq(auditLog.targetId, ana.json().user.id)).run();
    deps.db.update(auditLog).set({ createdAt: 2000 }).where(eq(auditLog.targetId, bruno.json().user.id)).run();

    const first = await app.inject({ method: 'GET', url: '/api/audit?page=1&limit=1', headers: { cookie } });
    expect(first.statusCode).toBe(200);
    expect(first.json().total).toBe(2);
    expect(first.json().entries).toHaveLength(1);
    expect(first.json().entries[0].action).toBe('user.create');
    expect(first.json().entries[0].targetId).toBe(bruno.json().user.id);

    const second = await app.inject({ method: 'GET', url: '/api/audit?page=2&limit=1', headers: { cookie } });
    expect(second.statusCode).toBe(200);
    expect(second.json().total).toBe(2);
    expect(second.json().entries).toHaveLength(1);
    expect(second.json().entries[0].targetId).toBe(ana.json().user.id);

    deps.db.update(auditLog).set({ createdAt: 3000 }).run();
    const tiedFirst = await app.inject({ method: 'GET', url: '/api/audit?page=1&limit=1', headers: { cookie } });
    expect(tiedFirst.json().entries[0].targetId).toBe(bruno.json().user.id);
    const tiedSecond = await app.inject({ method: 'GET', url: '/api/audit?page=2&limit=1', headers: { cookie } });
    expect(tiedSecond.json().entries[0].targetId).toBe(ana.json().user.id);

    const invalid = await app.inject({ method: 'GET', url: '/api/audit?limit=101', headers: { cookie } });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});
