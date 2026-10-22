import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from '../../src/api/plugins/security';

describe('isAllowedOrigin', () => {
  it('aceita a origem pública configurada', () => {
    expect(isAllowedOrigin('https://bot.exemplo.com', 'interno:3000', 'https://bot.exemplo.com')).toBe(true);
  });

  it('rejeita origem diferente', () => {
    expect(isAllowedOrigin('https://malicioso.com', 'bot.exemplo.com', 'https://bot.exemplo.com')).toBe(false);
  });

  it('usa o host quando não há PUBLIC_URL', () => {
    expect(isAllowedOrigin('http://localhost:3000', 'localhost:3000', undefined)).toBe(true);
    expect(isAllowedOrigin('http://localhost:9999', 'localhost:3000', undefined)).toBe(false);
  });

  it('rejeita quando não há referência', () => {
    expect(isAllowedOrigin('http://x', undefined, undefined)).toBe(false);
  });
});
