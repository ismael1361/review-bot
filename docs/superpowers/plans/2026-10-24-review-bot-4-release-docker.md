# review-bot — Plano 4: Release Docker, onboarding zero-config e README

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar uma imagem Docker multi-arch pronta para release no GHCR, instalação sem `.env` e um primeiro acesso guiado na web, com README auto-instrutivo e imagens.

**Architecture:** O container continua único (Fastify + SQLite). A configuração passa a resolver `env > banco > padrão`; a chave de criptografia é gerada em arquivo `0600` dentro de `DATA_DIR`; o token de setup é gerado no processo e exibido apenas no wizard; o setup inicial cobre root, GitHub, perfil de IA e configurações da instância. A publicação usa GitHub Actions com buildx para `linux/amd64` e `linux/arm64`, imagem no GHCR e anexos leves na release.

**Tech Stack:** Node 22, Bun (build), Fastify, Drizzle/SQLite, React/Vite, Vitest, Playwright, Docker buildx, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-22-pr-review-agent-design.md` (seções 12–16) + este plano. Pré-requisito: Planos 1, 2 e 3 concluídos (em especial o painel final do Plano 2 e a documentação operacional do Plano 3).

## Global Constraints

- Instalação sem `.env`: `docker compose up -d` e primeiro acesso em `http://localhost:7080`.
- Precedência de configuração: variável de ambiente definida > valor salvo no banco > padrão do plano. Variável vazia conta como ausente.
- `PORT` padrão: `7080`; `DATA_DIR` padrão local: `./data`; na imagem Docker: `/data`.
- `PUBLIC_URL` padrão: `http://localhost:${PORT}`; `TRUST_PROXY` padrão `false`; `ALLOW_PRIVATE_URLS` padrão `false`.
- `APP_ENCRYPTION_KEY`: env > `DATA_DIR/.encryption-key` (`0600`) > gerada com 32 bytes aleatórios. Nunca versionar, logar ou incluir no build.
- `SETUP_TOKEN`: env > token aleatório gerado no boot e exibido apenas no wizard de setup. Hash no banco; remover o hash ao concluir.
- O setup só existe enquanto `setup_complete` for falso; depois disso as rotas respondem `409`/`404` conforme o existente.
- Nenhum segredo em imagens, logs, README ou artefatos de release.
- Release somente em tags `v*`; imagem `ghcr.io/<owner>/review-bot:<tag>` para `amd64` e `arm64`; anexos leves (compose, `.env.example`, checksums).
- Sem commits automáticos; cada task termina em checkpoint verde e o ledger registra o estado.
- Testes não dependem de rede externa; Docker smoke usa imagem local e volume temporário.

## File Map

```
src/config.ts                         defaults, env opcional, empty=ausente
src/instance/keys.ts                  geração/leitura da chave em DATA_DIR
src/instance/settings.ts              publicUrl/trustProxy/allowPrivateUrls no banco
src/auth/setup.ts                     token de setup em memória + hash no banco
src/api/routes/setup.ts               status com token e criação do root
src/api/routes/instance.ts            GET/PUT das configurações da instância
src/api/app.ts                        registra a rota de instância
src/server.ts                         ordem DB -> migrations -> chave -> settings -> app
src/web/pages/Setup.tsx               wizard de primeiro acesso
src/web/pages/Dashboard.tsx           checklist de onboarding pendente
src/web/pages/settings/System.tsx     link para configurações da instância
Dockerfile                            multi-stage, non-root, healthcheck, porta 7080
.dockerignore                         contexto enxuto
docker-compose.yml                    fonte local, zero-config
docker-compose.release.yml            template da release (imagem GHCR)
.env.example                          todas as variáveis opcionais e padrões
.github/workflows/release.yml         buildx multi-arch + GHCR + GitHub Release
docs/images/*.png                     screenshots do README
scripts/seed-demo.ts                  dados de demonstração para os screenshots
scripts/capture-screenshots.mjs       captura Playwright das telas
tests/unit/config.test.ts             defaults e precedência
tests/unit/instance-keys.test.ts      chave em arquivo, permissões e falhas
tests/integration/instance-settings.test.ts  settings da instância
tests/web/setup-wizard.test.tsx        fluxo do wizard
tests/web/readme.test.ts              seções e imagens do README
```

---

### Task 1: Configuração zero-config e chave de criptografia em arquivo

**Files:**
- Modify: `src/config.ts`
- Create: `src/instance/keys.ts`
- Modify: `src/server.ts`
- Test: `tests/unit/config.test.ts`, `tests/unit/instance-keys.test.ts`

**Interfaces:**
- Consumes: `Db`, `githubCredentials`, `aiProfiles`, `loadEncryptionKey`.
- Produces: `loadConfig(env): Config` com `APP_ENCRYPTION_KEY?: string`, `PUBLIC_URL?: string`, `PORT=7080`, `DATA_DIR='./data'`, `TRUST_PROXY=false`, `ALLOW_PRIVATE_URLS=false`; `resolveEncryptionKey(db, dataDir, envKey?): Buffer`.

- [ ] **Step 1: Escrever os testes de configuração**

Em `tests/unit/config.test.ts`, adicionar:

```ts
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
```

Em `tests/unit/instance-keys.test.ts`:

```ts
it('gera a chave em DATA_DIR com permissão 0600 e reutiliza', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-bot-key-'));
  const db = createTestDb();
  const first = resolveEncryptionKey(db, dir);
  const file = join(dir, '.encryption-key');
  expect(readFileSync(file, 'utf8').trim()).toBe(first.toString('base64'));
  if (process.platform !== 'win32') {
    expect(statSync(file).mode & 0o777).toBe(0o600);
  }
  expect(resolveEncryptionKey(db, dir).equals(first)).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

it('recusa gerar chave nova quando o banco já tem segredos', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-bot-key-'));
  const db = createTestDb();
  db.insert(githubCredentials).values({ id: 'singleton', login: 'bot', patEncrypted: 'v1:x', patLast4: 'abcd', scopes: 'repo', validatedAt: Date.now(), updatedAt: Date.now() }).run();
  expect(() => resolveEncryptionKey(db, dir)).toThrow(/chave de criptografia/i);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Rodar e ver o vermelho**

Run: `bunx vitest run tests/unit/config.test.ts tests/unit/instance-keys.test.ts`
Expected: FAIL (padrões antigos, chave obrigatória, módulo `instance/keys` inexistente).

- [ ] **Step 3: Ajustar `src/config.ts`**

Remover a obrigatoriedade de `APP_ENCRYPTION_KEY` e `PUBLIC_URL` em produção. Usar `emptyToUndefined` para `APP_ENCRYPTION_KEY`, `PUBLIC_URL` e `SETUP_TOKEN`; `PORT` default `7080`; manter `DATA_DIR` default `./data`, `TRUST_PROXY=false`, `ALLOW_PRIVATE_URLS=false`. O objeto `Config` continua com `isProduction`/`isTest`.

- [ ] **Step 4: Criar `src/instance/keys.ts`**

```ts
import { count } from 'drizzle-orm';
import { closeSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Db } from '../db/client';
import { aiProfiles, githubCredentials } from '../db/schema';
import { loadEncryptionKey } from '../auth/crypto';

const KEY_FILE = '.encryption-key';

function hasEncryptedSecrets(db: Db): boolean {
  const credentials = db.select({ value: count() }).from(githubCredentials).get()?.value ?? 0;
  const profiles = db.select({ value: count() }).from(aiProfiles).get()?.value ?? 0;
  return credentials > 0 || profiles > 0;
}

export function resolveEncryptionKey(db: Db, dataDir: string, envKey?: string): Buffer {
  if (envKey?.trim()) {
    return loadEncryptionKey(envKey.trim());
  }
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, KEY_FILE);
  try {
    return loadEncryptionKey(readFileSync(path, 'utf8').trim());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  if (hasEncryptedSecrets(db)) {
    throw new Error('Chave de criptografia ausente em DATA_DIR; restaure .encryption-key antes de iniciar');
  }
  const key = randomBytes(32);
  try {
    const fd = openSync(path, 'wx', 0o600);
    try {
      writeSync(fd, key.toString('base64'));
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
    return loadEncryptionKey(readFileSync(path, 'utf8').trim());
  }
  return key;
}
```

- [ ] **Step 5: Atualizar `src/server.ts`**

Ordem: `mkdirSync(DATA_DIR)`, abrir DB, `runMigrations`, `resolveEncryptionKey(db, DATA_DIR, config.APP_ENCRYPTION_KEY)`, `ensureSetupToken`, `purgeExpiredSessions`, `buildApp`. Não ler a chave antes de o DB existir.

- [ ] **Step 6: Rodar e verificar**

Run: `bunx vitest run tests/unit/config.test.ts tests/unit/instance-keys.test.ts`
Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run: `bun run typecheck; bun run lint`
Expected: limpos.

---

### Task 2: Configurações da instância e token de setup exibido na web

**Files:**
- Create: `src/instance/settings.ts`
- Create: `src/api/routes/instance.ts`
- Modify: `src/api/app.ts`
- Modify: `src/auth/setup.ts`
- Modify: `src/api/routes/setup.ts`
- Modify: `src/server.ts`
- Modify: `src/web/pages/Setup.tsx`
- Test: `tests/integration/instance-settings.test.ts`, `tests/web/setup.test.tsx`

**Interfaces:**
- Produces: `InstanceSettings` (`publicUrl?`, `trustProxy`, `allowPrivateUrls`); `getInstanceSettings(db)`, `saveInstanceSettings(db, input)`, `applyInstanceSettings(config, stored, env)`, `socket` route `GET/PUT /api/settings/instance`; `ensureSetupToken(db, logger, envToken?)` retorna o token em memória; `getSetupTokenForDisplay()`.

- [ ] **Step 1: Escrever os testes de settings da instância**

`tests/integration/instance-settings.test.ts`:

```ts
it('admin salva publicUrl/trustProxy/allowPrivateUrls e viewer recebe 403', async () => {
  const { app, deps } = await createTestApp();
  const admin = await setupRootAndLogin(app, deps);
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/settings/instance',
    headers: { cookie: admin },
    payload: { publicUrl: 'https://reviews.example.com', trustProxy: true, allowPrivateUrls: false },
  });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().settings.publicUrl).toBe('https://reviews.example.com');
  expect(getSetting(deps.db, 'instance')).toMatchObject({ publicUrl: 'https://reviews.example.com', trustProxy: true });
  const got = await app.inject({ method: 'GET', url: '/api/settings/instance', headers: { cookie: admin } });
  expect(got.json().settings.trustProxy).toBe(true);
  await app.close();
});
```

- [ ] **Step 2: Rodar e ver o vermelho**

Run: `bunx vitest run tests/integration/instance-settings.test.ts`
Expected: FAIL (rota inexistente).

- [ ] **Step 3: Criar `src/instance/settings.ts`**

```ts
import { z } from 'zod';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { getSetting, setSetting } from '../db/settings';

const INSTANCE_KEY = 'instance';

export const InstanceSettings = z.object({
  publicUrl: z.string().url().refine((value) => /^https?:\/\//i.test(value), 'Use http(s)').optional(),
  trustProxy: z.boolean().default(false),
  allowPrivateUrls: z.boolean().default(false),
});

export type InstanceSettingsType = z.infer<typeof InstanceSettings>;

export function getInstanceSettings(db: Db): InstanceSettingsType {
  return InstanceSettings.parse(getSetting<Partial<InstanceSettingsType>>(db, INSTANCE_KEY) ?? {});
}

export function saveInstanceSettings(db: Db, input: InstanceSettingsType): InstanceSettingsType {
  const parsed = InstanceSettings.parse(input);
  setSetting(db, INSTANCE_KEY, parsed);
  return parsed;
}

export function applyInstanceSettings(config: Config, stored: InstanceSettingsType, env: NodeJS.ProcessEnv): { trustProxyChanged: boolean } {
  const previousTrust = config.TRUST_PROXY;
  const envPublicUrl = env.PUBLIC_URL?.trim() || undefined;
  const envAllowPrivate = env.ALLOW_PRIVATE_URLS?.trim();
  const envTrust = env.TRUST_PROXY?.trim();
  config.PUBLIC_URL = envPublicUrl ?? stored.publicUrl ?? `http://localhost:${config.PORT}`;
  config.ALLOW_PRIVATE_URLS = envAllowPrivate ? envAllowPrivate === 'true' : stored.allowPrivateUrls;
  config.TRUST_PROXY = envTrust ? envTrust === 'true' : stored.trustProxy;
  return { trustProxyChanged: previousTrust !== config.TRUST_PROXY };
}
```

- [ ] **Step 4: Criar a rota `src/api/routes/instance.ts`**

`GET /api/settings/instance` e `PUT /api/settings/instance`, admin-only, com `InstanceSettings.parse`, `saveInstanceSettings`, `applyInstanceSettings(deps.config, settings, process.env)` e `audit`. Resposta `{ settings, restartRequired }`; `restartRequired` é `true` somente quando `trustProxyChanged`.

- [ ] **Step 5: Token de setup exibido na web**

Em `src/auth/setup.ts`:

- `let cachedSetupToken: string | undefined;`
- `ensureSetupToken`: se setup concluído, limpar cache e retornar. Se `envToken` não vazio, gravar o hash e não guardar plaintext. Se já existe token em cache, retornar. Caso contrário, gerar `randomBytes(32).toString('base64url')`, gravar o hash e guardar em `cachedSetupToken`; **não** logar o token gerado.
- `getSetupTokenForDisplay(): string | undefined` retorna `cachedSetupToken`.
- `completeSetup` limpa `cachedSetupToken` ao concluir.

Em `src/api/routes/setup.ts`:

```ts
app.get('/api/setup/status', async () => {
  if (isSetupComplete(deps.db)) {
    return { needsSetup: false };
  }
  const envToken = deps.config.SETUP_TOKEN?.trim();
  return {
    needsSetup: true,
    tokenSource: envToken ? 'env' : 'generated',
    setupToken: envToken ? undefined : getSetupTokenForDisplay(),
  };
});
```

- [ ] **Step 6: Atualizar `src/web/pages/Setup.tsx`**

Buscar o status; se `tokenSource==='generated'`, preencher o campo de token em modo somente leitura e mostrar botão “Copiar token”. Se `env`, mostrar campo editável com “Use o token definido em SETUP_TOKEN”. Texto de aviso: “Qualquer pessoa com acesso a esta instância antes de concluir o setup pode criar o root. Conclua agora ou defina SETUP_TOKEN no .env.” Após sucesso, navegar para o wizard de onboarding (Task 3).

- [ ] **Step 7: Rodar e verificar**

Run: `bunx vitest run tests/integration/instance-settings.test.ts tests/web/setup.test.tsx`
Expected: PASS.

---

### Task 3: Wizard de primeiro acesso (root, GitHub, IA, instância)

**Files:**
- Modify: `src/web/pages/Setup.tsx`
- Modify: `src/web/pages/Dashboard.tsx`
- Create: `src/web/components/Onboarding.tsx` (se necessário)
- Test: `tests/web/setup-wizard.test.tsx`

**Interfaces:**
- Consumes: `POST /api/setup`, `PUT /api/settings/github`, `POST /api/ai-profiles`, `PUT /api/settings/instance`.
- Produces: wizard em 4 passos; checklist de onboarding no Dashboard quando GitHub/perfil/instância estiverem ausentes.

- [ ] **Step 1: Escrever o teste do wizard**

`tests/web/setup-wizard.test.tsx` (jsdom, Testing Library, TanStack Query, `QueryClientProvider`):

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Setup } from '../../src/web/pages/Setup';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status });
}

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Setup />
    </QueryClientProvider>,
  );
}

it('percorre root, GitHub, IA e configurações da instância', async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/setup/status') return json({ needsSetup: true, tokenSource: 'generated', setupToken: 'setup-token-123456' });
    if (url === '/api/setup') return json({ userId: 'u1' }, 201);
    if (url === '/api/settings/github') return json({ credentials: { login: 'bot', patLast4: 'abcd', scopes: 'repo' } });
    if (url === '/api/ai-profiles') return json({ profile: { id: 'p1' } }, 201);
    if (url === '/api/settings/instance') return json({ settings: { publicUrl: 'http://localhost:7080', trustProxy: false, allowPrivateUrls: false }, restartRequired: false });
    return json({}, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  renderWizard();
  await screen.findByDisplayValue('setup-token-123456');
  await userEvent.type(screen.getByLabelText('Usuário'), 'root');
  await userEvent.type(screen.getByLabelText('Senha'), 'senha-muito-segura');
  await userEvent.type(screen.getByLabelText('Confirmar senha'), 'senha-muito-segura');
  await userEvent.click(screen.getByRole('button', { name: 'Criar root' }));
  await screen.findByRole('heading', { name: /GitHub/i });
  await userEvent.type(screen.getByLabelText('Personal Access Token'), 'ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  await userEvent.click(screen.getByRole('button', { name: 'Salvar e continuar' }));
  await screen.findByRole('heading', { name: /Perfil de IA/i });
  await userEvent.click(screen.getByRole('button', { name: 'Pular por agora' }));
  await screen.findByRole('heading', { name: /Configurações da instância/i });
  await userEvent.click(screen.getByRole('button', { name: 'Concluir' }));
  expect(fetchMock).toHaveBeenCalledWith('/api/settings/github', expect.objectContaining({ method: 'PUT' }));
});
```

- [ ] **Step 2: Rodar e ver o vermelho**

Run: `bunx vitest run tests/web/setup-wizard.test.tsx`
Expected: FAIL (wizard ainda não existe).

- [ ] **Step 3: Implementar o wizard em `Setup.tsx`**

Passos e chamadas:

1. **Root:** token exibido/editável, usuário, senha, confirmação; `POST /api/setup`; a sessão já é criada pelo servidor.
2. **GitHub:** campo PAT; `PUT /api/settings/github` com `{ pat }`; botão “Pular por agora”.
3. **Perfil de IA:** nome, provedor (`openai_compatible`/`anthropic`), base URL, modelo, API key; defaults `temperature: 0.2`, `maxOutputTokens: 4096`, `maxTurns: 20`, `maxTotalTokens: 200000`, `maxDurationSec: 600`, `maxFindings: 25`, `maxGithubCalls: 80`, `prePrompt: ''`, `skillIds: []`; `POST /api/ai-profiles`; botão “Pular por agora”.
4. **Instância:** `publicUrl` (default `http://localhost:7080`), `trustProxy`, `allowPrivateUrls`; `PUT /api/settings/instance`; se `restartRequired`, mostrar “Reinicie o container para aplicar TRUST_PROXY”; botão “Concluir”.
5. Navegar para `/` com `queryClient.invalidateQueries()`.

Usar `Card`, `Field`, `Input`, `Button`, `ErrorText`. Não criar comentários.

- [ ] **Step 4: Checklist de onboarding no Dashboard**

Adicionar um card “Primeiros passos” quando `me.data?.role === 'admin'` e algum item estiver pendente. Links para `/settings/github`, `/settings/ia` e `/settings/sistema`. O card some quando as consultas `github`, `profiles` e `system` indicarem configuração. Não bloquear o dashboard.

- [ ] **Step 5: Editar configurações da instância depois do setup**

Em `src/web/pages/settings/System.tsx`, adicionar uma seção “Instância” com `publicUrl`, `trustProxy` e `allowPrivateUrls`, carregando `GET /api/settings/instance` e salvando `PUT /api/settings/instance`. Exibir a mensagem de reinício quando `restartRequired` for `true`.

- [ ] **Step 6: Rodar e verificar**

Run: `bunx vitest run tests/web/setup-wizard.test.tsx tests/web/setup.test.tsx`
Expected: PASS.

---

### Task 4: Dockerfile de release

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`
- Test: build e smoke locais

**Interfaces:**
- Produces: imagem `review-bot` com `PORT=7080`, `DATA_DIR=/data`, usuário `node`, healthcheck `/healthz`, volume `/data`.

- [ ] **Step 1: Reescrever o `Dockerfile`**

```dockerfile
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

FROM oven/bun:1 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM node:22-bookworm-slim AS runtime
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="review-bot"
LABEL org.opencontainers.image.description="Automated pull request review bot"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.revision="${REVISION}"
ENV NODE_ENV=production
ENV PORT=7080
ENV DATA_DIR=/data
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 7080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:7080/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server/server.js"]
```

- [ ] **Step 2: Atualizar `.dockerignore`**

Incluir `node_modules`, `dist`, `data`, `coverage`, `.env`, `.git`, `.superpowers`, `design`, `docs`, `tests`, `*.md`, `sonar-project.properties`, `docker-compose*.yml`. Não excluir `drizzle`.

- [ ] **Step 3: Build local**

Run: `docker build -t review-bot:release-test .`
Expected: exit 0; imagem criada.

- [ ] **Step 4: Smoke sem `.env`**

```bash
docker volume create review-bot-smoke
docker run --rm -d --name review-bot-smoke -p 7080:7080 -v review-bot-smoke:/data review-bot:release-test
```

Aguardar health e chamar `curl -s http://localhost:7080/api/setup/status`; esperar `needsSetup: true` e `setupToken` presente. Depois:

```bash
docker rm -f review-bot-smoke
docker volume rm review-bot-smoke
```

---

### Task 5: Compose zero-config e template da release

**Files:**
- Modify: `docker-compose.yml`
- Create: `docker-compose.release.yml`
- Modify: `.env.example`
- Test: `docker compose config` sem `.env`

**Interfaces:**
- Produces: `docker compose up -d` funcional sem `.env`; `docker-compose.release.yml` com placeholder `__IMAGE__` para o workflow.

- [ ] **Step 1: Reescrever `docker-compose.yml`**

```yaml
services:
  app:
    build: .
    image: review-bot:local
    environment:
      PORT: ${PORT:-7080}
      DATA_DIR: /data
      PUBLIC_URL: ${PUBLIC_URL:-}
      APP_ENCRYPTION_KEY: ${APP_ENCRYPTION_KEY:-}
      SETUP_TOKEN: ${SETUP_TOKEN:-}
      TRUST_PROXY: ${TRUST_PROXY:-false}
      ALLOW_PRIVATE_URLS: ${ALLOW_PRIVATE_URLS:-false}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      TZ: ${TZ:-UTC}
    ports:
      - "${PORT:-7080}:${PORT:-7080}"
    volumes:
      - review-bot-data:/data
    restart: unless-stopped
    init: true
    stop_grace_period: 30s
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:7080/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      start_period: 20s
      retries: 3

volumes:
  review-bot-data:
```

- [ ] **Step 2: Criar `docker-compose.release.yml`**

Mesmo conteúdo, mas `image: __IMAGE__` e sem `build`. O workflow substitui `__IMAGE__` por `ghcr.io/<owner>/review-bot:<tag>`.

- [ ] **Step 3: Atualizar `.env.example`**

```env
# Todas as variáveis são opcionais. Sem .env, os padrões abaixo são usados.
PORT=7080
DATA_DIR=./data
PUBLIC_URL=
APP_ENCRYPTION_KEY=
SETUP_TOKEN=
TRUST_PROXY=false
ALLOW_PRIVATE_URLS=false
LOG_LEVEL=info
TZ=UTC
```

- [ ] **Step 4: Verificar compose sem `.env`**

Run: `docker compose config`
Expected: YAML válido, porta 7080, volume `review-bot-data`, sem erro por `.env` ausente.

Run: `docker compose -f docker-compose.release.yml config`
Expected: erro apenas do placeholder `__IMAGE__`; validar o restante.

---

### Task 6: Workflow de release no GitHub

**Files:**
- Create: `.github/workflows/release.yml`
- Test: buildx local + revisão do YAML

**Interfaces:**
- Produces: tags `v*` publicam `ghcr.io/<owner>/review-bot:<tag>` multi-arch e criam release com `docker-compose.yml`, `.env.example` e `SHA256SUMS`.

- [ ] **Step 1: Criar o workflow**

```yaml
name: release

on:
  push:
    tags: ['v*']

permissions:
  contents: write
  packages: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: image
        run: echo "name=ghcr.io/$(echo '${{ github.repository_owner }}' | tr '[:upper:]' '[:lower:]')/review-bot" >> "$GITHUB_OUTPUT"
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ steps.image.outputs.name }}
          tags: |
            type=semver,pattern={{version}}
            type=raw,value=latest
      - uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          build-args: |
            VERSION=${{ github.ref_name }}
            REVISION=${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: true
          sbom: true
      - name: Preparar anexos
        run: |
          mkdir -p release
          sed "s|__IMAGE__|${{ steps.image.outputs.name }}:${{ github.ref_name }}|" docker-compose.release.yml > release/docker-compose.yml
          cp .env.example release/.env.example
          (cd release && sha256sum docker-compose.yml .env.example > SHA256SUMS)
      - uses: softprops/action-gh-release@v2
        with:
          generate_release_notes: true
          files: |
            release/docker-compose.yml
            release/.env.example
            release/SHA256SUMS
```

- [ ] **Step 2: Validar localmente**

Run: `docker buildx build --platform linux/amd64 --load -t review-bot:release-local .`
Expected: exit 0.

Run: `docker compose -f docker-compose.release.yml config` (após substituir `__IMAGE__` por `review-bot:release-local` em uma cópia temporária)
Expected: YAML válido.

- [ ] **Step 3: Checklist do workflow**

Conferir: permissões `packages: write`/`contents: write`; tag `v*`; plataformas amd64/arm64; imagem minúscula; anexos leves; sem segredos no YAML.

---

### Task 7: README auto-instrutivo com imagens

**Files:**
- Modify: `README.md`
- Modify: `docs/operations.md` (seções de zero-config e release)
- Create: `docs/images/setup.png`, `docs/images/dashboard.png`, `docs/images/queue.png`, `docs/images/review-detail.png`, `docs/images/settings.png`
- Create: `scripts/seed-demo.ts`, `scripts/capture-screenshots.mjs`
- Test: `tests/web/readme.test.ts`

**Interfaces:**
- Produces: README com quick start de 3 passos, configuração zero-config, tabela de env, backup/upgrade, troubleshooting e imagens; teste que valida seções e arquivos.

- [ ] **Step 1: Capturar as imagens**

Criar `scripts/seed-demo.ts` que usa `createDb`/`runMigrations` e insere, em `DATA_DIR/review-bot.db` (somente demo local), IDs fixos `demo-repo` (repositório `acme/demo`), `demo-job` (job `succeeded`), `demo-review` (review com corpo Markdown) e `demo-finding-1..3` (findings `critical`, `medium` e `suggestion` em `src/demo.ts`). Usar `onConflictDoNothing` para ser idempotente. `docs/images/setup.png` pode ser exportado do mockup (a tela /setup redireciona após concluído); as demais telas usam o app real. Criar `scripts/capture-screenshots.mjs`:

```js
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:7080';
const user = process.env.DEMO_USER ?? 'root';
const password = process.env.DEMO_PASSWORD ?? 'senha-muito-segura';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' });
await page.goto(`${base}/login`);
await page.getByLabel('Usuário').fill(user);
await page.getByLabel('Senha').fill(password);
await page.getByRole('button', { name: 'Entrar' }).click();
await page.waitForURL(`${base}/`);
await page.screenshot({ path: 'docs/images/dashboard.png', fullPage: true });
await page.goto(`${base}/queue`);
await page.screenshot({ path: 'docs/images/queue.png', fullPage: true });
await page.goto(`${base}/reviews/${process.env.DEMO_REVIEW_ID ?? 'demo-review'}`);
await page.screenshot({ path: 'docs/images/review-detail.png', fullPage: true });
await page.goto(`${base}/settings`);
await page.screenshot({ path: 'docs/images/settings.png', fullPage: true });
await page.goto(`${base}/setup`);
await page.screenshot({ path: 'docs/images/setup.png', fullPage: true });
await browser.close();
```

Executar com o app local e `bunx playwright install chromium` (se ainda não instalado pelo Plano 3). As imagens devem ter 1440 px de largura e tema escuro.

- [ ] **Step 2: Reescrever o `README.md`**

Estrutura obrigatória:

1. Título, uma frase e imagem `docs/images/dashboard.png`.
2. “O que faz” (polling, agente, review inline, painel, SSE).
3. “Instalação rápida (sem .env)”:
   ```bash
   docker compose up -d
   ```
   Abrir `http://localhost:7080`; o wizard gera o token de setup, cria o root e guia GitHub/IA/instância. Avisar que qualquer pessoa com acesso antes do setup pode criar o root; para exposição pública, definir `SETUP_TOKEN`.
4. “Instalação pela release”:
   ```bash
   docker compose -f docker-compose.yml up -d
   ```
   com o arquivo baixado da release; imagem GHCR `ghcr.io/<owner>/review-bot:<tag>`.
5. “Primeiro acesso” com os 4 passos do wizard e links para as telas.
6. “Configuração” com a tabela:

| Variável | Padrão | Quando definir |
|---|---|---|
| `PORT` | `7080` | Conflito de porta |
| `DATA_DIR` | `./data` (imagem: `/data`) | Volume diferente |
| `PUBLIC_URL` | `http://localhost:7080` | Proxy/TLS e cookies Secure |
| `APP_ENCRYPTION_KEY` | gerada em `DATA_DIR/.encryption-key` | Backup externo/rotação |
| `SETUP_TOKEN` | gerado no wizard | Exposição pública antes do setup |
| `TRUST_PROXY` | `false` | Atrás de proxy reverso |
| `ALLOW_PRIVATE_URLS` | `false` | Provedor/webhook em rede privada |
| `LOG_LEVEL` | `info` | Diagnóstico |
| `TZ` | `UTC` | Fuso dos logs |

7. “Onde ficam os dados” (SQLite, `.encryption-key`, backup separado; exemplo `docker run --rm -v review-bot-data:/data ...` ou `docker compose exec`).
8. “Proxy e TLS” (`TRUST_PROXY=true`, `PUBLIC_URL=https://...`, reiniciar).
9. “Atualização” (`docker compose pull`, `up -d`, migrations no boot, backup antes).
10. “Solução de problemas” (porta ocupada, volume sem permissão, chave perdida, token de setup, healthcheck, logs).
11. “Desenvolvimento” (Bun, Node 22, comandos de teste/build).
12. Imagens de setup, fila, detalhe de review e definições com legendas.

- [ ] **Step 3: Atualizar `docs/operations.md`**

Adicionar uma seção “Zero-config” com os mesmos defaults, precedência env > banco > padrão, localização da chave e o aviso de backup separado; e uma seção “Release” com a imagem GHCR multi-arch e o compose da release.

- [ ] **Step 4: Teste do README**

`tests/web/readme.test.ts` lê `README.md` e verifica: seções `Instalação rápida`, `Configuração`, `Primeiro acesso`, `Backup`, `Solução de problemas`; e que cada caminho `docs/images/*.png` referenciado existe via `existsSync`. Falhar com a lista de imagens ausentes.

- [ ] **Step 5: Rodar e verificar**

Run: `bunx vitest run tests/web/readme.test.ts`
Expected: PASS.

---

### Task 8: Verificação final do Plano 4

**Files:**
- Nenhum novo; executar verificações e corrigir eventuais falhas.

- [ ] **Step 1: Suíte e build**

Run: `bun run typecheck; bun run lint; bun run test; bun run build`
Expected: todos verdes.

- [ ] **Step 2: Compose sem `.env`**

Run: `docker compose config`
Expected: sem erro de `.env`; porta 7080 e volume corretos.

- [ ] **Step 3: Zero-config ponta a ponta**

```bash
docker compose up -d --build
```

Aguardar healthcheck; abrir `http://localhost:7080` (ou `curl -s http://localhost:7080/api/setup/status`) e confirmar `needsSetup: true` com `setupToken`. Concluir o wizard; confirmar login, dashboard e que `DATA_DIR/.encryption-key` existe e tem modo 0600:

```bash
docker compose exec app ls -l /data/.encryption-key
```

Reiniciar:

```bash
docker compose restart
```

Confirmar que o setup continua concluído, o login funciona e a chave foi reutilizada (arquivo com o mesmo conteúdo).

- [ ] **Step 4: Backup e limpeza**

```bash
docker compose down
docker volume ls | grep review-bot
```

Não apagar o volume sem antes documentar; para o teste local, remover apenas o volume temporário criado para o smoke.

- [ ] **Step 5: Release local**

Run: `docker buildx build --platform linux/amd64 --load -t review-bot:release-local .`
Expected: exit 0.

Revisar o workflow `.github/workflows/release.yml` com o checklist da Task 6; o push real de tag fica para o operador.

- [ ] **Step 6: Checkpoint final**

Registrar no ledger: comandos executados, resultados, imagem/tag testada, screenshots gerados e pendências. Sem commits automáticos.

---

## Riscos e decisões registradas

- **Chave de criptografia em arquivo:** escolhida em vez do banco para que o backup do SQLite não contenha a chave. O backup precisa incluir `DATA_DIR/.encryption-key` separadamente; sem ela, segredos existentes não podem ser decifrados e o boot falha de forma explícita.
- **Token de setup visível na web:** atende ao zero-config, mas permite que o primeiro visitante crie o root. O README avisa; `SETUP_TOKEN` continua disponível para instalações expostas.
- **`TRUST_PROXY`:** é aplicado no boot do Fastify; alterar pelo wizard grava no banco e retorna `restartRequired`. `PUBLIC_URL` e `ALLOW_PRIVATE_URLS` são aplicados em memória imediatamente.
- **Porta 7080:** escolhida por ser pouco comum em stacks de desenvolvimento; pode ser trocada por `PORT`.
- **Release sem tar da imagem:** a instalação usa GHCR; os anexos leves evitam artefatos de centenas de MB. Instalação offline não faz parte deste plano.
- **Screenshots:** usam o app final com dados de demonstração; se o ambiente não tiver Playwright, exportar os mockups de `design/review-bot-mockups.figcraft` e manter os mesmos nomes/legendas.
