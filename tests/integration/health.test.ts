import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';

describe('GET /healthz', () => {
  it('responde ok', async () => {
    const { app } = await createTestApp();
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
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
