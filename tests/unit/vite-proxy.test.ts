import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createViteConfig } from '../../vite.config';

type ProxyOptions = { target?: string };
type ProxyMap = Record<string, string | ProxyOptions>;
type LaunchConfig = { configurations: Array<{ name: string; envFile?: string }> };

const proxy = (createViteConfig({ PORT: '4321' }).server?.proxy ?? {}) as ProxyMap;

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

  it('usa a porta do ambiente e 127.0.0.1 no proxy', () => {
    expect(proxy['^/api(?:/|$)']).toBe('http://127.0.0.1:4321');
    expect(proxy['^/healthz(?:/|$)']).toBe('http://127.0.0.1:4321');
  });

  it('usa 7080 quando PORT não está definida', () => {
    const fallback = (createViteConfig({}).server?.proxy ?? {}) as ProxyMap;
    expect(fallback['^/api(?:/|$)']).toBe('http://127.0.0.1:7080');
    expect(fallback['^/healthz(?:/|$)']).toBe('http://127.0.0.1:7080');
  });

  it('carrega o mesmo .env no debug da API e do Vite', () => {
    const raw = readFileSync(join(process.cwd(), '.vscode', 'launch.json'), 'utf8');
    const launch = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '')) as LaunchConfig;
    const api = launch.configurations.find((item) => item.name === 'API (Node + tsx)');
    const web = launch.configurations.find((item) => item.name === 'Web (Vite)');

    expect(api?.envFile).toBe('${workspaceFolder}/.env');
    expect(web?.envFile).toBe('${workspaceFolder}/.env');
  });
});
