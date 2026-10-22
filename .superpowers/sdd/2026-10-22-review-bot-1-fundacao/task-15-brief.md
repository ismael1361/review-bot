### Task 15: Docker, Compose e README

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.env.example`, `.dockerignore`, `README.md`
- Test: verificação de build e de configuração do Compose.

**Interfaces:**
- Consumes: `yarn build` (gera `dist/server/server.js` e `dist/web`), `drizzle/`.
- Produces: imagem `review-bot` executável com volume `/data`.

- [ ] **Step 1: Criar `Dockerfile`**

```dockerfile
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable
COPY . .
RUN yarn build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "dist/server/server.js"]
```

- [ ] **Step 2: Criar `docker-compose.yml`, `.env.example` e `.dockerignore`**

`docker-compose.yml`:

```yaml
services:
  app:
    build: .
    image: review-bot:local
    env_file: .env
    ports:
      - "3000:3000"
    volumes:
      - data:/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  data:
```

`.env.example`:

```
APP_ENCRYPTION_KEY=
PUBLIC_URL=http://localhost:3000
DATA_DIR=/data
PORT=3000
TRUST_PROXY=false
ALLOW_PRIVATE_URLS=false
LOG_LEVEL=info
TZ=UTC
```

`.dockerignore`:

```
node_modules
dist
data
.env
coverage
```

- [ ] **Step 3: Implementar `src/server.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config';
import { createLogger } from './logger';
import { createDb } from './db/client';
import { runMigrations } from './db/migrate';
import { loadEncryptionKey } from './auth/crypto';
import { ensureSetupToken } from './auth/setup';
import { createEventBus } from './events/bus';
import { buildApp } from './api/app';

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = createLogger(config);
  mkdirSync(config.DATA_DIR, { recursive: true });
  const { db } = createDb(join(config.DATA_DIR, 'review-bot.db'));
  runMigrations(db, join(process.cwd(), 'drizzle'));
  const encryptionKey = loadEncryptionKey(config.APP_ENCRYPTION_KEY);
  ensureSetupToken(db, logger, config.SETUP_TOKEN);
  const app = await buildApp({ db, config, logger, encryptionKey, bus: createEventBus() });
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  logger.info({ port: config.PORT }, 'review-bot iniciado');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'encerrando');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
```

- [ ] **Step 4: Criar `README.md`**

```markdown
# review-bot

Painel e automação de review de Pull Requests. Esta fase entrega a fundação: setup do root, autenticação, usuários com papéis, definições de GitHub, perfis de IA, skills, webhooks, repositórios, fila (somente leitura), dashboard e SSE. O poller e o worker de review chegam na próxima fase.

## Instalação

1. Copie `.env.example` para `.env` e gere a chave: `openssl rand -base64 32` em `APP_ENCRYPTION_KEY`.
2. Ajuste `PUBLIC_URL` para a URL pública (o TLS fica a cargo do seu proxy reverso).
3. `docker compose up -d`.
4. Leia o token de setup: `docker compose logs app`.
5. Acesse o painel e crie o usuário root.

## Desenvolvimento

- `yarn install`
- `yarn dev` (API em http://localhost:3000)
- `yarn dev:web` (SPA em http://localhost:5173 com proxy para a API)
- `yarn test`, `yarn typecheck`, `yarn lint`

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `APP_ENCRYPTION_KEY` | 32 bytes em base64 (obrigatória) |
| `SETUP_TOKEN` | Substitui o token de setup gerado |
| `PUBLIC_URL` | URL pública (obrigatória em produção) |
| `DATA_DIR` | Diretório do SQLite (padrão `/data` na imagem) |
| `TRUST_PROXY` | Confia em cabeçalhos do proxy |
| `ALLOW_PRIVATE_URLS` | Permite provedores/webhooks em rede privada |

## Backup

Com o container em execução, copie `data/review-bot.db` usando `sqlite3 .backup` ou pare o container antes de copiar (WAL). O script de backup automatizado chega na fase de operação.
```

- [ ] **Step 5: Verificar build e Compose**

Run: `yarn build`
Expected: `dist/server/server.js` e `dist/web/index.html` existem.

Run: `Copy-Item .env.example .env` e preencher `APP_ENCRYPTION_KEY` com uma chave de 32 bytes em base64 (ex.: `MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=`).

Run: `docker compose config` (se Docker estiver instalado)
Expected: YAML válido com o serviço `app` e o volume `data`.

- [ ] **Step 6: Smoke manual**

PowerShell:

```powershell
$env:APP_ENCRYPTION_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
$env:DATA_DIR = "$env:TEMP\review-bot-smoke"
$env:PORT = "3210"
node dist/server/server.js
```

Em outro terminal:

```powershell
curl.exe -s http://127.0.0.1:3210/healthz
curl.exe -s http://127.0.0.1:3210/api/setup/status
```

Expected: `{"status":"ok"}` e `{"needsSetup":true}`; o log do servidor mostra o token de setup. Encerre com Ctrl+C.

- [ ] **Step 7: Checkpoint**

Run: `yarn typecheck; yarn lint; yarn test; yarn build`
Expected: todos verdes.

---
