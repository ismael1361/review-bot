import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { appSettings, users } from '../../src/db/schema';
import { createTestApp } from '../helpers/app';

const body = { token: 'token-de-setup-de-teste-123456', username: 'root', password: 'senha-muito-segura' };

describe('setup', () => {
  it('indica que o setup é necessário', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(response.json()).toEqual({ needsSetup: true });
    await app.close();
  });

  it('rejeita token inválido', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/setup', payload: { ...body, token: 'errado-errado-errado' } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_setup_token');
    await app.close();
  });

  it('cria o root e encerra o setup', async () => {
    const { app, deps } = await createTestApp();
    const created = await app.inject({ method: 'POST', url: '/api/setup', payload: body });
    expect(created.statusCode).toBe(201);
    expect(created.json().userId).toBeTruthy();
    const root = deps.db.select().from(users).where(eq(users.username, 'root')).get();
    expect(root).toMatchObject({ username: 'root', role: 'admin', isRoot: true });
    const tokenRow = deps.db.select().from(appSettings).where(eq(appSettings.key, 'setup_token_hash')).get();
    expect(tokenRow).toBeUndefined();
    const status = await app.inject({ method: 'GET', url: '/api/setup/status' });
    expect(status.json()).toEqual({ needsSetup: false });
    const again = await app.inject({ method: 'POST', url: '/api/setup', payload: { ...body, username: 'outro' } });
    expect(again.statusCode).toBe(409);
    await app.close();
  });

  it('rejeita setup concorrente', async () => {
    const { app } = await createTestApp();
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/setup', payload: body }),
      app.inject({ method: 'POST', url: '/api/setup', payload: { ...body, username: 'root2' } }),
    ]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    await app.close();
  });

  it('valida senha mínima', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/setup', payload: { ...body, password: 'curta' } });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
