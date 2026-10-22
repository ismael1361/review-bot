import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
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
});
