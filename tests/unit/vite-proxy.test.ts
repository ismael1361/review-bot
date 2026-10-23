import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';

type ProxyOptions = { target?: string };
type ProxyMap = Record<string, string | ProxyOptions>;

const proxy = (viteConfig.server?.proxy ?? {}) as ProxyMap;

function proxyEntryFor(url: string): string | undefined {
  return Object.keys(proxy).find((context) =>
    context.startsWith('^') ? new RegExp(context).test(url) : url.startsWith(context),
  );
}

describe('configuração de proxy do Vite', () => {
  it('encaminha requisições da API para o backend', () => {
    expect(proxyEntryFor('/api/setup/status')).toBeDefined();
    expect(proxyEntryFor('/api/users?page=1')).toBeDefined();
    expect(proxyEntryFor('/api')).toBeDefined();
  });

  it('não encaminha módulos do front-end cujo nome começa com "api"', () => {
    expect(proxyEntryFor('/api.ts')).toBeUndefined();
    expect(proxyEntryFor('/api-client.ts')).toBeUndefined();
  });

  it('encaminha o healthcheck sem capturar módulos homônimos', () => {
    expect(proxyEntryFor('/healthz')).toBeDefined();
    expect(proxyEntryFor('/healthz.ts')).toBeUndefined();
  });
});
