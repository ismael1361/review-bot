import { describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

const webhookBody = { url: 'https://93.184.216.34/hook', events: ['job.failed', 'webhook.test'] };

describe('webhooks', () => {
  it('cria com secret, testa entrega e lista entregas', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', headers: { cookie }, payload: webhookBody });
    expect(created.statusCode).toBe(201);
    expect(typeof created.json().secret).toBe('string');
    const id = created.json().webhook.id;

    const tested = await app.inject({ method: 'POST', url: `/api/webhooks/${id}/test`, headers: { cookie } });
    expect(tested.json().ok).toBe(true);
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    const headers = calls[0]![1].headers as Record<string, string>;
    expect(headers['x-prreviewer-event']).toBe('webhook.test');
    expect(headers['x-prreviewer-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);

    const deliveries = await app.inject({ method: 'GET', url: `/api/webhooks/${id}/deliveries`, headers: { cookie } });
    expect(deliveries.json().deliveries).toHaveLength(1);
    expect(deliveries.json().deliveries[0].success).toBe(true);
    vi.unstubAllGlobals();
    await app.close();
  });

  it('bloqueia URL privada por padrão', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', headers: { cookie }, payload: { ...webhookBody, url: 'http://127.0.0.1:9000/hook' } });
    expect(created.statusCode).toBe(400);
    await app.close();
  });

  it('não segue redirecionamento para URL privada', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } }));
    vi.stubGlobal('fetch', fetchImpl);
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', headers: { cookie }, payload: webhookBody });
    expect(created.statusCode).toBe(201);
    const id = created.json().webhook.id;
    const tested = await app.inject({ method: 'POST', url: `/api/webhooks/${id}/test`, headers: { cookie } });
    expect(tested.json().ok).toBe(false);
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [url, init] of calls) {
      expect(url).toBe(webhookBody.url);
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(calls.some(([url]) => url.includes('127.0.0.1'))).toBe(false);
    const deliveries = await app.inject({ method: 'GET', url: `/api/webhooks/${id}/deliveries`, headers: { cookie } });
    expect(deliveries.json().deliveries).toHaveLength(3);
    expect(deliveries.json().deliveries.every((d: { success: boolean }) => d.success === false)).toBe(true);
    vi.unstubAllGlobals();
    await app.close();
  }, 15000);

  it('tenta novamente em falha e registra tentativas', async () => {
    const fetchImpl = vi.fn(async () => new Response('erro', { status: 500 }));
    vi.stubGlobal('fetch', fetchImpl);
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    const created = await app.inject({ method: 'POST', url: '/api/webhooks', headers: { cookie }, payload: webhookBody });
    const id = created.json().webhook.id;
    const tested = await app.inject({ method: 'POST', url: `/api/webhooks/${id}/test`, headers: { cookie } });
    expect(tested.json().ok).toBe(false);
    const deliveries = await app.inject({ method: 'GET', url: `/api/webhooks/${id}/deliveries`, headers: { cookie } });
    expect(deliveries.json().deliveries).toHaveLength(3);
    expect(deliveries.json().deliveries.every((d: { success: boolean }) => d.success === false)).toBe(true);
    vi.unstubAllGlobals();
    await app.close();
  }, 15000);
});
