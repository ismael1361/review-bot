import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../src/auth/rate-limit';

describe('createRateLimiter', () => {
  it('bloqueia quando o máximo é atingido', () => {
    const now = 0;
    const limiter = createRateLimiter({ max: 2, windowMs: 1000, now: () => now });
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false);
    expect(limiter.check('b')).toBe(true);
  });

  it('reinicia a janela após o intervalo', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => now });
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false);
    now = 1000;
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('a')).toBe(false);
    now = 2000;
    expect(limiter.check('a')).toBe(true);
  });

  it('limita o número de entradas e rejeita novas chaves no limite', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, maxEntries: 2, now: () => 0 });
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(true);
    expect(limiter.check('c')).toBe(false);
    expect(limiter.check('a')).toBe(false);
  });

  it('limpa entradas expiradas ao atingir o limite de entradas', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, maxEntries: 2, now: () => now });
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(true);
    now = 1000;
    expect(limiter.check('c')).toBe(true);
    expect(limiter.check('d')).toBe(true);
  });

  it('reseta uma chave existente depois da janela mesmo com o mapa cheio', () => {
    let now = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, maxEntries: 2, now: () => now });
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(true);
    now = 1000;
    expect(limiter.check('a')).toBe(true);
    expect(limiter.check('b')).toBe(true);
  });
});
