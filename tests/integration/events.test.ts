import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { destroySession } from '../../src/auth/sessions';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';

describe('SSE', () => {
  it('entrega eventos publicados no bus', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie }, signal: controller.signal });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const connected = await reader.read();
    expect(new TextDecoder().decode(connected.value)).toContain('connected');
    deps.bus.publish({ type: 'queue.updated', data: { queued: 1 }, at: Date.now() });
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain('event: queue.updated');
    expect(text).toContain('"queued":1');
    controller.abort();
    await app.close();
  });

  it('encerra o stream quando a sessão é revogada', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie }, signal: controller.signal });
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      const connected = await reader.read();
      expect(new TextDecoder().decode(connected.value)).toContain('connected');
      destroySession(deps.db, cookie.slice('prr_session='.length));
      deps.bus.publish({ type: 'queue.updated', data: { queued: 2 }, at: Date.now() });
      const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), 1000);
      });
      const outcome = await Promise.race([
        reader.read().then((result) => ({ kind: 'read' as const, result })),
        timeout,
      ]);
      if (outcome.kind === 'timeout') {
        throw new Error('stream não encerrou após revogação da sessão');
      }
      expect(outcome.result.done).toBe(true);
      expect(outcome.result.value).toBeUndefined();
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      await app.close().catch(() => undefined);
    }
  }, 10000);

  it('fecha o app mesmo com conexão SSE aberta', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { cookie }, signal: controller.signal });
      expect(response.status).toBe(200);
      reader = response.body!.getReader();
      const connected = await reader.read();
      expect(new TextDecoder().decode(connected.value)).toContain('connected');
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), 3000);
      });
      const result = await Promise.race([app.close().then(() => 'closed' as const), timeout]);
      expect(result).toBe('closed');
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      await app.close().catch(() => undefined);
    }
  }, 10000);

  it('limita a 50 conexões SSE simultâneas', async () => {
    const { app, deps } = await createTestApp();
    const cookie = await setupRootAndLogin(app, deps);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const controllers: AbortController[] = [];
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    try {
      for (let index = 0; index < 50; index += 1) {
        const controller = new AbortController();
        controllers.push(controller);
        const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
          headers: { cookie },
          signal: controller.signal,
        });
        expect(response.status).toBe(200);
        const reader = response.body!.getReader();
        readers.push(reader);
        const connected = await reader.read();
        expect(new TextDecoder().decode(connected.value)).toContain('connected');
      }
      const response = await app.inject({ method: 'GET', url: '/api/events', headers: { cookie } });
      expect(response.statusCode).toBe(503);
      expect(response.json().error.code).toBe('too_many_streams');
    } finally {
      for (const controller of controllers) {
        controller.abort();
      }
      await Promise.all(readers.map((reader) => reader.cancel().catch(() => undefined)));
      await app.close().catch(() => undefined);
    }
  }, 20000);
});
