import { describe, expect, it } from 'vitest';
import { setSetting } from '../../src/db/settings';
import { createTestApp } from '../helpers/app';

describe('GET /readyz', () => {
  it('responde ok com formato esperado e uptime', async () => {
    const { app } = await createTestApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/readyz' });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toEqual({ status: 'ok', paused: false, uptimeSec: expect.any(Number) });
      expect(Number.isInteger(body.uptimeSec)).toBe(true);
      expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
    } finally {
      await app.close();
    }
  });

  it('reporta paused true após pausar a fila', async () => {
    const { app, deps } = await createTestApp();
    try {
      setSetting(deps.db, 'queue_paused', true);
      const response = await app.inject({ method: 'GET', url: '/readyz' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', paused: true, uptimeSec: expect.any(Number) });
    } finally {
      await app.close();
    }
  });
});
