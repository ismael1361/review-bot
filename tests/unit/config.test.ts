import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const base = {
  APP_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  NODE_ENV: 'test',
} as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('aplica padrões', () => {
    const config = loadConfig(base);
    expect(config.PORT).toBe(7080);
    expect(config.DATA_DIR).toBe('./data');
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.isTest).toBe(true);
  });

  it('converte booleanos textuais corretamente', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
  });

  it('usa os padrões zero-config', () => {
    const config = loadConfig({ NODE_ENV: 'production' });
    expect(config.PORT).toBe(7080);
    expect(config.DATA_DIR).toBe('./data');
    expect(config.APP_ENCRYPTION_KEY).toBeUndefined();
    expect(config.PUBLIC_URL).toBeUndefined();
    expect(config.TRUST_PROXY).toBe(false);
    expect(config.ALLOW_PRIVATE_URLS).toBe(false);
  });

  it('trata variáveis vazias como ausentes', () => {
    const config = loadConfig({ NODE_ENV: 'production', APP_ENCRYPTION_KEY: '', PUBLIC_URL: '', SETUP_TOKEN: '' });
    expect(config.APP_ENCRYPTION_KEY).toBeUndefined();
    expect(config.PUBLIC_URL).toBeUndefined();
    expect(config.SETUP_TOKEN).toBeUndefined();
  });

  it('aceita produção sem PUBLIC_URL definida', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).not.toThrow();
  });

  it('aceita PUBLIC_URL http e https', () => {
    expect(loadConfig({ ...base, PUBLIC_URL: 'https://bot.exemplo.com' }).PUBLIC_URL).toBe('https://bot.exemplo.com');
    expect(loadConfig({ ...base, PUBLIC_URL: 'http://localhost:3000' }).PUBLIC_URL).toBe('http://localhost:3000');
  });

  it('rejeita PUBLIC_URL com esquema diferente de http e https', () => {
    expect(() => loadConfig({ ...base, PUBLIC_URL: 'ftp://bot.exemplo.com' })).toThrow(/PUBLIC_URL/);
  });
});
