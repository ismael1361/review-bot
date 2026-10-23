import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';

describe('GET /healthz', () => {
  it('responde ok com o banco disponível', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', db: true });
    await app.close();
  });

  it('responde 503 quando o banco falha', async () => {
    const { app, deps } = await createTestApp();
    const spy = vi.spyOn(deps.db, 'run').mockImplementation(() => {
      throw new Error('banco indisponível');
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/healthz' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'error', db: false });
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
});

describe('GET /readyz', () => {
  it('responde ok com estado da fila e uptime', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.status).toBe('ok');
    expect(typeof body.paused).toBe('boolean');
    expect(body.paused).toBe(false);
    expect(typeof body.uptimeSec).toBe('number');
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    await app.close();
  });

  it('responde 503 quando o banco falha', async () => {
    const { app, deps } = await createTestApp();
    const spy = vi.spyOn(deps.db, 'run').mockImplementation(() => {
      throw new Error('banco indisponível');
    });
    try {
      const response = await app.inject({ method: 'GET', url: '/readyz' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'error' });
    } finally {
      spy.mockRestore();
      await app.close();
    }
  });
});

describe('erros do Fastify', () => {
  it('mapeia JSON malformado para 400', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('bad_request');
    await app.close();
  });
});
