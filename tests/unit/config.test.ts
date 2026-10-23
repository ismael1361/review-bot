import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const base = {
  APP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  NODE_ENV: 'test',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('aplica padrões', () => {
    const config = loadConfig(base);
    expect(config.PORT).toBe(3000);
    expect(config.DATA_DIR).toBe('./data');
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.isTest).toBe(true);
  });

  it('converte booleanos textuais corretamente', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });

  it('exige chave de criptografia', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/APP_ENCRYPTION_KEY/);
  });

  it('exige PUBLIC_URL em produção', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/PUBLIC_URL/);
  });

  it('aceita PUBLIC_URL http e https', () => {
    expect(loadConfig({ ...base, PUBLIC_URL: 'https://bot.exemplo.com' }).PUBLIC_URL).toBe('https://bot.exemplo.com');
    expect(loadConfig({ ...base, PUBLIC_URL: 'http://localhost:3000' }).PUBLIC_URL).toBe('http://localhost:3000');
  });

  it('rejeita PUBLIC_URL com esquema diferente de http e https', () => {
    expect(() => loadConfig({ ...base, PUBLIC_URL: 'ftp://bot.exemplo.com' })).toThrow(/PUBLIC_URL/);
  });
});
