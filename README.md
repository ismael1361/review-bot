# review-bot

Painel e automação de code review de Pull Requests. O bot consulta a API do GitHub, encontra PRs com review solicitado à conta configurada, executa um agente de IA com ferramentas somente leitura sobre o diff e publica um review com resumo e comentários inline. Ele nunca aprova nem solicita alterações na PR.

A aplicação é um único processo Node.js com API Fastify, SPA React, poller e workers internos, persistidos em SQLite. O guia operacional completo, o runbook de falhas e o checklist de aceite estão em [`docs/operations.md`](docs/operations.md).

## O que o bot faz

- Consulta `is:pr is:open review-requested:@me` na conta do token GitHub (polling, sem webhook de entrada).
- Deduplica por repositório, PR e SHA; um novo commit com novo review request gera um novo job. PRs rascunho e PRs da própria conta podem ser ignoradas nas configurações do sistema.
- Monta o contexto da PR com metadados, arquivos e patches (limite de 300 arquivos ou 1 MB de diff) e comentários existentes, tratando o conteúdo como não confiável contra prompt injection.
- Executa o loop agêntico com ferramentas de leitura do GitHub (`get_pr_files`, `read_file`, `list_directory`, `list_tree`, `search_code`, `get_commits`, `get_existing_comments`) e ferramentas de registro de achados.
- Valida path e linhas contra o diff. Achados fora do diff são movidos para o corpo do review (fallback). Segredos detectados na saída são redigidos.
- Publica uma review `COMMENT` no commit analisado, com marcador idempotente por job, resumo em Markdown e comentários inline válidos.
- Expõe dashboard, fila, histórico, detalhe da review, eventos em tempo real (SSE), definições administrativas e auditoria.

### Telas

- **Setup:** token de setup, criação do root e bloqueio após a conclusão.
- **Login e Senha:** autenticação por sessão e troca da própria senha.
- **Dashboard:** cards de fila, reviews das últimas 24 h e 7 dias, falhas e consumo de tokens.
- **Reviews:** histórico de reviews publicadas, status, comentários, link para o GitHub e acesso ao detalhe.
- **Detalhe da review:** corpo do review renderizado em Markdown, achados por severidade e arquivo, trecho do diff com a linha destacada, sugestão em bloco de código, status/turnos/tokens/comentários, transcrição e ação de republicar.
- **Fila:** pausa/retomada, jobs por estado, enfileiramento manual, cancelamento, reprocessamento e nova execução (forçar).
- **Definições (admin):** GitHub, perfis de IA, skills, usuários, webhooks, sistema e auditoria.
- **Tema:** tema escuro (paleta opencode) por padrão, com tokens semânticos (`--bg`, `--surface`, `--border`, `--text` etc.); os tokens dos temas claro e escuro estão definidos em `src/web/theme.css`.

## Requisitos

- Docker Engine com Docker Compose v2.
- Uma conta GitHub dedicada ao bot e um Personal Access Token (PAT).
- Um provedor de IA compatível com a API de chat da OpenAI ou com a API da Anthropic.
- Para desenvolvimento: Bun 1.4.2 (lockfileVersion 2) e Node.js >= 22.

## Instalação com Docker Compose

1. Copie o arquivo de ambiente e gere a chave de criptografia:

   ```bash
   cp .env.example .env
   openssl rand -base64 32
   ```

   Preencha `APP_ENCRYPTION_KEY` com a saída do comando. Guarde a chave em local seguro: ela cifra o PAT, as chaves de IA e os secrets dos webhooks.

2. Ajuste `PUBLIC_URL` para a URL pública exata, por exemplo `https://reviews.exemplo.com`, e `TRUST_PROXY=true` quando houver proxy reverso.

3. Opcionalmente, defina `SETUP_TOKEN` no `.env` antes do primeiro boot para usar um token de setup conhecido. Sem ele, o token é gerado e exibido uma única vez no log.

4. Suba o serviço:

   ```bash
   docker compose up -d --build
   ```

5. Leia o token de setup no log:

   ```bash
   docker compose logs app
   ```

   Procure a linha `Token de setup (uso único): ...`. Ele é exibido uma única vez; se perdê-lo antes de concluir o setup, defina `SETUP_TOKEN` no `.env` e reinicie, ou recrie o volume ainda não configurado.

6. Acesse a URL pública, informe o token e crie o usuário root com senha de no mínimo 12 caracteres.

7. Conclua o onboarding em **Definições**: salve e teste o PAT, crie e ative um perfil de IA e confirme que a fila não está pausada.

O container roda como usuário `node`, escuta internamente na porta 3000 e persiste o banco no volume `data` montado em `/data`. O Compose publica a porta apenas em `127.0.0.1:3000` (loopback). O healthcheck usa `GET /healthz`; `GET /readyz` informa se a **fila** está pausada (a pausa do poller não aparece nele; ela será exibida na saúde do dashboard após a Task 8).

### Proxy reverso, TLS e HSTS

Não há TLS embutido na aplicação. O Compose já publica a porta somente em loopback (`127.0.0.1:3000`); mantenha o proxy reverso no mesmo host e termine o TLS nele (Caddy, Nginx, Traefik etc.). Recomenda-se:

- Redirecionar HTTP para HTTPS.
- Enviar `Host`, `X-Forwarded-Proto` e `X-Forwarded-For`; manter `TRUST_PROXY=true` no `.env`.
- Desativar buffering para o endpoint SSE `/api/events` e aumentar o timeout de leitura.
- Adicionar `Strict-Transport-Security` (HSTS), por exemplo `max-age=31536000; includeSubDomains`, depois de validar o HTTPS em todos os subdomínios.
- Manter `PUBLIC_URL` com `https://`; isso também faz o cookie de sessão ser emitido como `Secure`.

Exemplo de bloco Nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

Se precisar de acesso direto pela LAN, altere a publicação no `docker-compose.yml`:

```yaml
ports:
  - "0.0.0.0:3000:3000"  # ou "192.168.0.10:3000:3000"
```

Restrinja a porta por firewall à rede necessária, por exemplo com UFW: `sudo ufw allow from 192.168.0.0/24 to any port 3000 proto tcp`. Isso expõe HTTP sem TLS; prefira manter loopback com o proxy.

## Configuração

### Token do GitHub (PAT)

Use uma conta dedicada ao bot e solicite o review dessa conta nas PRs. O poller consulta apenas PRs com review solicitado à conta do token.

- **Fine-grained token:** selecione os repositórios que o bot pode revisar e conceda Metadata (read), Contents (read) e Pull requests (read/write).
- **Classic token:** use o escopo `repo` para repositórios privados (ou `public_repo` se apenas repositórios públicos forem revisados).
- Em organizações com SSO, autorize o token para a organização.
- Salve em **Definições > GitHub** com **Salvar e testar**. A tela exibe o login e os 4 últimos caracteres do token (`patLast4`); os escopos retornados podem ser conferidos na resposta de `POST /api/settings/github/test`. O token é cifrado com AES-256-GCM e não é retornado pela API.
- O token precisa de acesso aos repositórios e permissão de leitura de código e escrita em reviews/comentários de PR.

### Perfis de IA

Em **Definições > IA**, crie um perfil com:

- provedor `openai_compatible` (endpoint `/chat/completions`) ou `anthropic` (endpoint `/v1/messages`);
- URL base, modelo e chave de API;
- limites de temperatura, tokens de saída, turnos, tokens totais, duração, achados e chamadas ao GitHub;
- pré-prompt e skills anexadas.

Apenas um perfil fica ativo por vez, e cada job usa um snapshot do perfil no momento em que entra na fila. Use **Testar** para validar URL, chave e modelo. As chaves de IA são cifradas e nunca retornadas pela API.

O conteúdo da PR, o diff e os comentários são enviados ao provedor de IA configurado. Avalie política de privacidade, retenção e custo do provedor antes de usar em repositórios com código restrito.

### Skills

Skills são instruções reutilizáveis em Markdown, criadas em **Definições > Skills** e anexadas a um perfil na ordem definida. Cada perfil aceita até 20 skills; o pré-prompt somado às skills não pode exceder 128 KB.

### Webhooks de saída

Em **Definições > Webhooks**, cadastre uma URL e selecione os eventos:

- `review.published`
- `job.failed`
- `job.partial`
- `poller.paused`

O secret é gerado automaticamente quando você não informa um (mínimo de 16 caracteres quando informado) e é exibido uma única vez na criação. As entregas usam `POST` JSON com os cabeçalhos `X-PRReviewer-Event` e `X-PRReviewer-Signature: sha256=<HMAC-SHA256 do corpo>`. São feitas até 3 tentativas (0 s, 1 s e 5 s), com timeout de 10 s. O histórico de entregas fica disponível na própria tela. URLs privadas, loopback, link-local e metadados são bloqueadas por padrão; veja `ALLOW_PRIVATE_URLS`.

## Operação

### Fila

- **Pausar/Retomar:** interrompe o polling e novos claims; o job em execução continua. O estado persiste entre reinícios.
- **Cancelar:** disponível para jobs `queued` ou `running`. O worker verifica o cancelamento, não publica a review e o job fica `cancelled`.
- **Reprocessar:** recoloca na fila um job `failed` ou `cancelled`, zerando as tentativas. A publicação é idempotente pelo marcador do job.
- **Enfileirar PR:** informe `owner/repo` e o número da PR. Exige PAT válido e perfil de IA ativo.
- **Forçar/nova execução:** marque **Forçar** para criar um novo job do mesmo SHA com `run_seq` incrementado. O histórico anterior é preservado e uma nova review é publicada. Sem **Forçar**, um SHA já enfileirado retorna conflito (409).

O bot usa uma fila FIFO persistente, com concorrência padrão 1 (configurável entre 1 e 3 em **Definições > Sistema**). Alterar a concorrência exige reiniciar o container para recriar os workers. Falhas transitórias são repetidas com espera de 30 s e 2 min entre as tentativas; erros do GitHub respeitam `Retry-After`/`x-ratelimit-reset`. Após 3 tentativas o job fica `failed` e emite `job.failed` na timeline; a entrega do webhook `job.failed` ainda não ocorre (lacuna conhecida).

### Backup

Com o container em execução:

```bash
docker compose exec app node scripts/backup.mjs
```

O script usa a API de backup do SQLite e grava um arquivo com timestamp em `DATA_DIR/backups` (`/data/backups` no container; `data/backups` em desenvolvimento). Copie do volume para o host:

```bash
mkdir -p backups
docker compose cp app:/data/backups/. ./backups/
```

O `docker compose cp` copia do volume para o host, não para fora dele. Depois transfira `./backups` para outro host ou storage, por exemplo com `scp -r ./backups usuario@servidor-backup:/caminho/` ou `rsync -a ./backups/ usuario@servidor-backup:/caminho/backups/`.

Faça backup antes de qualquer upgrade. O procedimento de restauração está em [`docs/operations.md`](docs/operations.md#backup-e-restauração).

### Redefinir senha

```bash
docker compose exec app node scripts/reset-password.mjs <username>
```

A nova senha é lida do stdin (mínimo de 12 caracteres), todas as sessões do usuário são revogadas e a ação é registrada na auditoria. Em terminal interativo a senha é exibida durante a digitação; para automação, canalize a entrada com `docker compose exec -T` e evite deixar a senha no histórico do shell.

### Upgrade

1. Faça backup.
2. Atualize o código ou a imagem.
3. Reconstrua e suba:

   ```bash
   docker compose build --pull
   docker compose up -d
   ```

   Se você publica a imagem em um registry, use `docker compose pull` no lugar do build.
4. Acompanhe `docker compose logs -f app` e confirme `GET /healthz`.

As migrations do SQLite rodam no boot. Uma falha de migration impede o start e aparece no log; restaure o backup e use a versão correspondente. Não há downgrade automático de schema.

## Segurança

- **Chave de criptografia:** `APP_ENCRYPTION_KEY` é obrigatória e deve ter 32 bytes em base64. A perda da chave torna ilegíveis o PAT, as chaves de IA e os secrets de webhook; será necessário recadastrá-los. Guarde a chave separada dos backups e nunca a versione no Git.
- **Segredos no banco:** PAT, chaves de IA e secrets de webhook são cifrados com AES-256-GCM. A API não retorna os valores; os logs usam redaction para campos conhecidos. Ainda assim, trate logs e backups como dados sensíveis.
- **SSRF:** por padrão, URLs de provedores e webhooks não podem apontar para loopback, rede privada, link-local ou metadados. `ALLOW_PRIVATE_URLS=true` libera esses destinos e deve ser usado apenas em rede interna confiável. A revalidação de redirecionamentos existe, mas o pinning do endereço validado não faz parte da v1.
- **Privacidade:** o código, o diff e os metadados da PR são enviados ao provedor de IA. Não use o bot em repositórios cujo código não possa sair da sua infraestrutura.
- **Rede e sessão:** use HTTPS/HSTS no proxy, mantenha a porta 3000 em loopback (padrão do Compose) e mantenha `PUBLIC_URL`/`TRUST_PROXY` coerentes. Para acesso LAN, altere o binding conscientemente e restrinja por firewall; não exponha HTTP sem TLS. Senhas usam Argon2id, o token de setup é de uso único e o root não pode ser removido.
- **Permissões:** `viewer` só lê, `operator` opera a fila e `admin` gerencia configurações. O último administrador ativo não pode ser removido.
- **Dados:** o volume contém banco, WAL e backups. Restrinja o acesso ao host e faça cópias fora dele.

## Limitações da v1

- Gatilho apenas por polling; não há webhooks de entrada do GitHub, menção ou comando em comentários.
- O bot não clona o repositório, não executa testes, não usa git/shell e não altera arquivos.
- Nunca envia `APPROVE` nem `REQUEST_CHANGES`; publica apenas reviews `COMMENT`.
- Uma conta GitHub e uma instalação por vez; sem múltiplas réplicas ou workers distribuídos.
- Sem 2FA no painel, notificações por e-mail, app mobile, i18n ou cálculo de custo/orçamento.
- Sem integração com Prometheus/Grafana; observabilidade por logs, eventos, dashboard e webhooks.
- TLS é responsabilidade do proxy reverso; não há proxy embutido na imagem.
- O aceite final em VPS com repositório de teste, PAT real e provedor de baixo custo é manual e deve ser registrado no checklist de `docs/operations.md`.

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `APP_ENCRYPTION_KEY` | Sim | — | 32 bytes em base64 para AES-256-GCM. Gere com `openssl rand -base64 32`. |
| `SETUP_TOKEN` | Não | gerado | Substitui o token de setup gerado. Mínimo de 16 caracteres; útil para recuperar o acesso antes do primeiro root. |
| `PUBLIC_URL` | Sim em produção | — | URL pública exata, usada em Origin, links e cookie `Secure` quando HTTPS. |
| `PORT` | Não | `3000` | Porta HTTP interna. |
| `DATA_DIR` | Não | `./data` (`/data` na imagem) | Diretório do SQLite, WAL e backups. O Compose define `/data`. |
| `TRUST_PROXY` | Não | `false` | Confia em `X-Forwarded-*`; habilite atrás de proxy reverso. |
| `ALLOW_PRIVATE_URLS` | Não | `false` | Permite provedores/webhooks em rede privada. Use somente em ambiente interno confiável. |
| `LOG_LEVEL` | Não | `info` | `fatal`, `error`, `warn`, `info`, `debug` ou `trace`. |
| `TZ` | Não | `UTC` | Fuso usado na exibição de datas. |

## Desenvolvimento

Requisitos: Bun 1.4.2 (lockfileVersion 2; o runtime da aplicação é Node.js >= 22).

```bash
bun install --frozen-lockfile
bun run dev        # API em http://localhost:3000
bun run dev:web    # SPA em http://localhost:5173 com proxy para a API
bun run test       # Vitest (unitários, integração e web)
bun run typecheck
bun run lint
bun run build      # gera dist/web e dist/server/server.js
bun run start      # inicia o build de produção
bun run e2e        # Playwright
```

Para desenvolvimento, crie o `.env` a partir de `.env.example` e preencha `APP_ENCRYPTION_KEY`. O `bun run dev` usa `DATA_DIR=./data` por padrão.

### E2E com Chrome do sistema

O Playwright está configurado para usar o Chrome instalado no sistema (`channel: chrome`) e sobe um servidor temporário na porta 3300 com `bun run build`. Portanto, `bun run e2e` não baixa Chromium por padrão. Se o Chrome não estiver disponível (por exemplo, em CI Linux), instale o Chromium e sobrescreva o canal:

```bash
bunx playwright install chromium
PLAYWRIGHT_CHANNEL=chromium bun run e2e
```

No PowerShell:

```powershell
$env:PLAYWRIGHT_CHANNEL = "chromium"; bun run e2e
```

`E2E_DATA_DIR` pode apontar para um diretório temporário específico; sem essa variável, o Playwright cria um diretório temporário e usa um setup limpo.

### Depuração no VS Code

As configurações estão em `.vscode/launch.json`:

- **API (Node + tsx)**: sobe a API com breakpoints, carregando o `.env` e usando `DATA_DIR=./data`.
- **Web (Vite)** e **Web (Chrome)**: SPA com breakpoints no navegador.
- **Full stack (API + Web)**: sobe API, Vite e Chrome juntos.
- **Teste atual (Vitest)**: executa e depura o arquivo de teste aberto.

## Documentação

- [`docs/operations.md`](docs/operations.md): arquitetura de processo, fluxo do job, runbook de falhas, restore, build multi-arquitetura e checklist AC-01..AC-13.
- [`docs/superpowers/specs/2026-10-22-pr-review-agent-design.md`](docs/superpowers/specs/2026-10-22-pr-review-agent-design.md): especificação funcional.
