import { describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/app';
import { setupRootAndLogin } from '../helpers/auth';
import { saveGithubCredentials } from '../../src/github/credentials';
import { aiProfiles, githubCredentials } from '../../src/db/schema';
import { createProfile } from '../../src/ai/profiles';
import { createLogger } from '../../src/logger';
import { loadConfig } from '../../src/config';
import { assertSafeUrl } from '../../src/shared/url-guard';
import { buildApp } from '../../src/api/app';
import { createDb, type Db } from '../../src/db/client';
import { runMigrations } from '../../src/db/migrate';
import { ensureSetupToken } from '../../src/auth/setup';
import { loadEncryptionKey } from '../../src/auth/crypto';
import { createEventBus } from '../../src/events/bus';

const PAT = 'ghp_1234567890abcdefghij';
const AI_KEY = 'sk-super-secreta-1234567890';
const SECRET_PASSWORD = 'senha-super-secreta';
const USER_PASSWORD = 'senha-muito-longa';

function closeDb(db: Db): void {
  (db as Db & { $client: { close(): void } }).$client.close();
}

describe('segurança', () => {
  it('cifra PAT e chave de IA em repouso e nunca os devolve', async () => {
    const { app, deps } = await createTestApp();
    try {
      const cookie = await setupRootAndLogin(app, deps);
      saveGithubCredentials(deps.db, deps.encryptionKey, { login: 'bot', pat: PAT, scopes: 'repo' });
      const credRow = deps.db.select().from(githubCredentials).get()!;
      expect(credRow.patEncrypted).toMatch(/^v1:/);
      expect(credRow.patEncrypted).not.toContain(PAT);

      const profile = createProfile(deps.db, deps.encryptionKey, {
        name: 'principal',
        provider: 'openai_compatible',
        baseUrl: 'https://provedor.exemplo.com/v1',
        model: 'modelo',
        apiKey: AI_KEY,
        temperature: 0.2,
        maxOutputTokens: 4096,
        maxTurns: 20,
        maxTotalTokens: 200000,
        maxDurationSec: 600,
        maxFindings: 25,
        maxGithubCalls: 80,
        prePrompt: '',
        skillIds: [],
      });
      const profileRow = deps.db.select().from(aiProfiles).get()!;
      expect(profileRow.apiKeyEncrypted).toMatch(/^v1:/);
      expect(profileRow.apiKeyEncrypted).not.toContain(AI_KEY);
      expect(profile.hasApiKey).toBe(true);

      const githubResponse = await app.inject({ method: 'GET', url: '/api/settings/github', headers: { cookie } });
      expect(githubResponse.statusCode).toBe(200);
      expect(githubResponse.body).not.toContain(PAT);
      expect(githubResponse.json().credentials).toEqual({ login: 'bot', patLast4: 'ghij', scopes: 'repo', validatedAt: expect.any(Number) });

      const profilesResponse = await app.inject({ method: 'GET', url: '/api/ai-profiles', headers: { cookie } });
      expect(profilesResponse.statusCode).toBe(200);
      expect(profilesResponse.body).not.toContain(AI_KEY);
      expect(profilesResponse.body).not.toContain('apiKeyEncrypted');
      expect(profilesResponse.json().profiles[0].hasApiKey).toBe(true);
    } finally {
      await app.close();
      closeDb(deps.db);
    }
  });

  it('redige segredos de topo e aninhados nos logs', () => {
    const chunks: string[] = [];
    const logger = createLogger(loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'info' }), {
      write: (chunk) => chunks.push(chunk),
    });
    logger.info(
      {
        token: PAT,
        apiKey: AI_KEY,
        password: SECRET_PASSWORD,
        nested: { token: PAT, apiKey: AI_KEY, password: SECRET_PASSWORD },
        req: {
          headers: { authorization: `Bearer ${PAT}`, cookie: 'prr_session=segredo-de-sessao' },
          body: { token: PAT, apiKey: AI_KEY, password: SECRET_PASSWORD },
        },
      },
      'teste de redaction',
    );
    const output = chunks.join('');
    expect(output).not.toBe('');
    for (const secret of [PAT, AI_KEY, SECRET_PASSWORD, 'segredo-de-sessao']) {
      expect(output).not.toContain(secret);
    }
  });

  it('bloqueia SSRF para metadados e endereços privados via lookup injetado', async () => {
    const consulted: string[] = [];
    const lookupTo = (address: string) => async (hostname: string) => {
      consulted.push(hostname);
      return [address];
    };

    await expect(
      assertSafeUrl('http://metadata.exemplo.com/latest/meta-data', { lookup: lookupTo('169.254.169.254') }),
    ).rejects.toThrow(/privado/);
    await expect(
      assertSafeUrl('http://servico.interno:11434', { lookup: lookupTo('10.0.0.5') }),
    ).rejects.toThrow(/privado/);
    expect(consulted).toEqual(['metadata.exemplo.com', 'servico.interno']);
  });

  it('impede viewer de criar jobs e operator de alterar credenciais', async () => {
    const { app, deps } = await createTestApp();
    try {
      const rootCookie = await setupRootAndLogin(app, deps);

      const viewer = await app.inject({
        method: 'POST',
        url: '/api/users',
        headers: { cookie: rootCookie },
        payload: { username: 'viewer1', password: USER_PASSWORD, role: 'viewer' },
      });
      expect(viewer.statusCode).toBe(201);
      const viewerLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'viewer1', password: USER_PASSWORD },
      });
      expect(viewerLogin.statusCode).toBe(200);
      const viewerCookie = `prr_session=${viewerLogin.cookies.find((item) => item.name === 'prr_session')!.value}`;
      const deniedJob = await app.inject({
        method: 'POST',
        url: '/api/jobs',
        headers: { cookie: viewerCookie },
        payload: { repoFullName: 'a/b', prNumber: 1 },
      });
      expect(deniedJob.statusCode).toBe(403);
      expect(deniedJob.json().error.code).toBe('forbidden');

      const operator = await app.inject({
        method: 'POST',
        url: '/api/users',
        headers: { cookie: rootCookie },
        payload: { username: 'op1', password: USER_PASSWORD, role: 'operator' },
      });
      expect(operator.statusCode).toBe(201);
      const operatorLogin = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'op1', password: USER_PASSWORD },
      });
      expect(operatorLogin.statusCode).toBe(200);
      const operatorCookie = `prr_session=${operatorLogin.cookies.find((item) => item.name === 'prr_session')!.value}`;
      const deniedSettings = await app.inject({
        method: 'PUT',
        url: '/api/settings/github',
        headers: { cookie: operatorCookie },
        payload: { pat: PAT },
      });
      expect(deniedSettings.statusCode).toBe(403);
      expect(deniedSettings.json().error.code).toBe('forbidden');
    } finally {
      await app.close();
      closeDb(deps.db);
    }
  });

  it('envia CSP com default-src self em produção', async () => {
    const { sqlite, db } = createDb(':memory:');
    const chunks: string[] = [];
    const config = loadConfig({ ...process.env, NODE_ENV: 'production', PUBLIC_URL: 'https://bot.exemplo.com', LOG_LEVEL: 'info' });
    const logger = createLogger(config, { write: (chunk) => chunks.push(chunk) });
    try {
      runMigrations(db, 'drizzle');
      const deps = {
        db,
        config,
        logger,
        encryptionKey: loadEncryptionKey(config.APP_ENCRYPTION_KEY),
        bus: createEventBus(),
      };
      ensureSetupToken(db, logger, 'token-de-setup-de-teste-123456');
      const app = await buildApp(deps);
      try {
        const response = await app.inject({ method: 'GET', url: '/healthz' });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      } finally {
        await app.close();
      }
    } finally {
      sqlite.close();
    }
  });
});
