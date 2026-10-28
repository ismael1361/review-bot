# Operação do review-bot

Este é o guia operacional da v1. Ele cobre a arquitetura de processo, o fluxo de um job, a operação zero-config, o runbook de falhas, backup e restauração, a release no GHCR e o checklist de aceite AC-01..AC-13.

> **Status do aceite:** os 13 critérios de aceite foram documentados, mas a execução final em VPS com repositório de teste, PAT real e provedor de baixo custo **ainda está pendente e é manual**. Nenhum critério deve ser considerado aprovado sem evidência registrada na seção final deste documento.

## Arquitetura de processo

O review-bot roda em **um único container** com um processo Node.js 22. Não há fila externa, banco externo nem workers distribuídos.

```
                         +----------------------------------+
  GitHub API  <--------> |  processo Node.js (container)   |
                         |                                  |
  Provedor IA <--------> |  Fastify + SPA estática          |
                         |  poller (intervalo configurável) |
                         |  workers internos (1 a 3)        |
                         |  SSE + retenção + sessões        |
                         +----------------+-----------------+
                                          |
                                          v
                                  SQLite em /data
                                  review-bot.db + WAL
```

- **API e SPA:** o mesmo processo serve a API Fastify, os arquivos estáticos da SPA e o SSE em `/api/events`.
- **Poller:** consulta `is:pr is:open review-requested:@me` na conta do PAT, pagina os resultados e cria jobs. O intervalo padrão é 60 s (mínimo 30 s, configurável em **Definições > Sistema**) e é relido a cada ciclo.
- **Workers:** o runtime cria de 1 a 3 workers conforme a concorrência configurada (padrão 1). Cada worker faz claim de um job `queued` a cada 2 s e executa o pipeline completo no próprio processo. Alterar a concorrência em **Definições > Sistema** exige reiniciar o container para recriar os workers.
- **SQLite:** `better-sqlite3` com `journal_mode=WAL`, `foreign_keys=ON` e `busy_timeout=5000`. O arquivo fica em `DATA_DIR` (`/data` na imagem), junto com WAL, SHM e backups.
- **Persistência da fila:** os jobs sobrevivem a reinícios. No boot e no shutdown, jobs que estavam `running` são devolvidos para `queued`; o heartbeat é de 30 s.
- **Escala:** a v1 não suporta múltiplas réplicas. O SQLite, o poller e os workers são locais ao container; concorrência acima de 1 aumenta a contenção de escrita, por isso o máximo é 3.
- **Migrations:** rodam automaticamente no boot a partir de `/app/drizzle`. Uma falha impede o start e deve ser tratada antes de subir a aplicação.
- **Porta:** o Compose usa `PORT=7080` e publica `${PORT:-7080}` somente em loopback (`127.0.0.1:${PORT:-7080}:${PORT:-7080}`) por padrão; mantenha o proxy reverso no mesmo host. Para acesso direto pela LAN, altere o mapeamento para `0.0.0.0:${PORT:-7080}:${PORT:-7080}` (ou o IP da interface), restrinja por firewall e não exponha HTTP sem TLS; o wizard de setup também fica acessível nessa interface até a conclusão.

## Fluxo de um job

1. **Polling:** o poller consulta a API do GitHub. Repositórios arquivados ou desabilitados, PRs rascunho (se configurado) e PRs da própria conta (se configurado) geram `poll.skipped`; PRs já vistas com `lastUpdatedAt` atual são ignoradas no ciclo sem novo job.
2. **Deduplicação:** a chave é repositório + PR + `head_sha`. Se já existe job para o SHA, o polling não duplica. Um novo commit muda o SHA e cria um novo job (`run_seq = 1`). O enfileiramento manual com **Forçar** cria outro job para o mesmo SHA com `run_seq` incrementado.
3. **Fila:** o job entra como `queued`, com snapshot do perfil de IA ativo no momento do enfileiramento. A ordem é FIFO por `queued_at`, com prioridade opcional.
4. **Claim:** um worker marca o job como `running`, registra `started_at`, incrementa `attempts` e passa a enviar heartbeat. Se a fila estiver pausada, nenhum novo claim acontece; o job em execução continua.
5. **Contexto:** o executor carrega metadados da PR, arquivos e patches (até 300 arquivos ou 1 MB de diff), comentários e reviews existentes. Em PRs de fork, lê arquivos do repositório head e publica no repositório base.
6. **Agente:** monta o prompt com o perfil, pré-prompt e skills; executa o loop com ferramentas somente leitura, limites de turnos, tokens, duração, achados e chamadas ao GitHub. Cada etapa relevante gera eventos `job.progress`.
7. **Validação:** verifica path, linhas e duplicatas. Achado fora do diff fica com status `outside_diff` e vai para o corpo do review. Segredos detectados são redigidos.
8. **Publicação:** faz uma única chamada `POST /repos/{owner}/{repo}/pulls/{n}/reviews` com `event=COMMENT`, `commit_id=head_sha`, resumo e comentários inline. O corpo começa com `<!-- pr-reviewer:job:{jobId} -->`. Antes de publicar, lista as reviews da PR (sem filtrar por commit) e procura o marcador do job para não duplicar. Se o GitHub rejeitar posições (422), republica sem comentários inline e move os achados para o corpo (`fallback`).
9. **Conclusão:** o job fica `succeeded`, `partial` (limites atingidos), `failed` ou `cancelled`. Sucesso, parcial e cancelamento percebido pelo worker emitem `job.finished`; falha emite `job.failed` (não `job.finished`). A publicação bem-sucedida emite `review.published` e dispara os webhooks configurados; `job.partial` é disparado quando o resultado é parcial. Falhas transitórias são reagendadas com backoff.
10. **Cancelamento:** um job `queued` ou `running` pode ser cancelado. O worker verifica o estado antes de publicar; o job fica `cancelled` e nenhuma review é publicada.

### Máquina de estados

```
queued --claim--> running --ok--> succeeded
                     |  \--limites--> partial
                     |  \--erro-----> failed --retry--> queued
                     |  \--cancel----> cancelled
                     \--shutdown/órfão--> queued
```

### Eventos

Os eventos são persistidos na tabela `events` e/ou publicados por SSE (heartbeat de 25 s).

- **Persistidos e publicados por SSE:** `job.started`, `job.progress`, `job.retry_scheduled`, `job.finished`, `job.failed`, `poll.updated`, `poll.skipped`, `poller.paused` e `job.created` do poller.
- **Somente SSE:** `queue.updated`, `job.created` do enfileiramento manual e `review.published`.

Eventos de webhook disponíveis para assinatura: `review.published`, `job.failed`, `job.partial`, `poller.paused` e `webhook.test` (entrega de teste). O worker entrega `job.failed` quando o job esgota as tentativas e falha em definitivo.

A retenção padrão é de 90 dias para transcrições, eventos, entregas de webhook e cache vencido; a auditoria mantém 180 dias. Jobs, reviews, achados e métricas permanecem.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `APP_ENCRYPTION_KEY` | gerada em `DATA_DIR/.encryption-key` | Opcional. Chave de 32 bytes em base64 para AES-256-GCM. Se definida, tem precedência sobre o arquivo; se ausente, o arquivo (0600) é lido ou gerado. Cifra PAT, chaves de IA e secrets de webhook. |
| `SETUP_TOKEN` | gerado no wizard | Opcional. Substitui o token de setup gerado; mínimo de 16 caracteres. O token gerado aparece somente no wizard `/setup`, nunca no log. |
| `PUBLIC_URL` | `http://localhost:7080` | Opcional. URL pública exata (`https://...`), usada para validar `Origin`, montar cookies e links. Também pode ser salva em **Definições > Sistema**. |
| `PORT` | `7080` | Porta HTTP interna e porta publicada pelo Compose. |
| `DATA_DIR` | `./data` (`/data` na imagem) | Diretório do SQLite, WAL, backups e `.encryption-key`. O Compose define `/data`. |
| `TRUST_PROXY` | `false` | Confia em `X-Forwarded-*`; habilite atrás de proxy reverso. Também pode ser salvo em **Definições > Sistema**. |
| `ALLOW_PRIVATE_URLS` | `false` | Permite provedores e webhooks em rede privada, loopback, link-local ou metadados. Também pode ser salvo em **Definições > Sistema**. Use somente em rede interna confiável. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug` ou `trace`. |
| `TZ` | `UTC` | Fuso usado na exibição de datas. |

O Compose sobrescreve `DATA_DIR` para `/data` e mantém o volume nomeado `review-bot-data`. O `NODE_ENV=production` é definido na imagem runtime.

## Zero-config

Sem `.env`, a instância sobe com os padrões da tabela: `PORT=7080`, `DATA_DIR=./data` (`/data` na imagem), `PUBLIC_URL` efetiva `http://localhost:7080`, `TRUST_PROXY=false`, `ALLOW_PRIVATE_URLS=false`, `LOG_LEVEL=info` e `TZ=UTC`. O wizard `/setup` gera o token de setup e o usuário root; não é necessário configurar chave nem token antes do primeiro boot.

Para `PUBLIC_URL`, `TRUST_PROXY` e `ALLOW_PRIVATE_URLS`, a precedência é **ambiente > banco > padrão**: o wizard e a tela **Definições > Sistema** gravam no banco, mas uma variável de ambiente equivalente sempre vence. As demais variáveis vêm apenas do ambiente e usam o padrão da tabela.

A chave de criptografia é opcional. A precedência é `APP_ENCRYPTION_KEY` > `DATA_DIR/.encryption-key` (0600) > chave nova gerada. Se houver PAT, chaves de IA ou secrets de webhook no banco e nenhuma chave estiver disponível, o boot falha para não perder o acesso aos segredos. Faça backup do banco e da `.encryption-key` separadamente; a perda da chave exige recadastrar os segredos.

O token de setup gerado só é exibido no wizard `/setup` e nunca é escrito no log. `SETUP_TOKEN` permite definir um token conhecido antes do primeiro boot, útil quando a instância fica exposta antes do setup.

## Procedimentos operacionais

### Verificar a saúde

```bash
docker compose ps
docker compose logs -f app
curl -fsS https://<seu-host>/healthz
curl -fsS https://<seu-host>/readyz
```

- `/healthz` verifica o processo e uma consulta SQLite. Retorna 503 se o banco falhar.
- `/readyz` também informa `paused`, que reflete **somente a pausa da fila**, e `uptimeSec`. A pausa do poller aparece na saúde do dashboard.
- O Compose tem healthcheck a cada 30 s, com 3 tentativas.

### Pausar e retomar a fila

Na interface, use **Fila > Pausar/Retomar**. As rotas equivalentes são `POST /api/queue/pause` e `POST /api/queue/resume`; elas exigem sessão autenticada e papel `operator` ou `admin`.

Pausar interrompe o polling e novos claims. O job em execução continua até concluir ou ser cancelado. O estado persiste entre reinícios.

### Backup e restauração

**Backup com o container em execução:**

```bash
docker compose exec app node scripts/backup.mjs
mkdir -p backups
docker compose cp app:/data/backups/. ./backups/
```

O script usa a API de backup do SQLite, grava em `DATA_DIR/backups/review-bot-<timestamp>.db` (`/data/backups` no container; `data/backups` em desenvolvimento) e imprime o caminho. O `docker compose cp` acima copia do volume para o host, não para fora dele. Em seguida, transfira `./backups` para outro host ou storage com `scp`/`rsync`, por exemplo:

```bash
scp -r ./backups usuario@servidor-backup:/caminho/
```

Guarde a cópia externa com o mesmo cuidado do banco: ela contém dados e segredos cifrados. A chave de criptografia deve ser guardada separadamente e **não** dentro de `./backups`. Se a instância usa a chave em arquivo, copie-a para um local separado:

```bash
docker compose cp app:/data/.encryption-key ./chave-encryption-key
chmod 600 ./chave-encryption-key
```

Guarde essa cópia de preferência fora do repositório. `chave-encryption-key`, `.encryption-key` e `backups/` estão no `.gitignore` e no `.dockerignore`; nunca inclua a chave no contexto de build nem a versione.

Se a chave vem de `APP_ENCRYPTION_KEY`, o arquivo não existe; guarde o valor em um gerenciador de segredos ou em outro local separado do backup.

**Restauração:**

1. Pare a aplicação:

   ```bash
   docker compose stop app
   ```

2. Restaure o arquivo para o volume, removendo antes o banco e os sidecars WAL/SHM. O comando abaixo usa a imagem da própria aplicação e o volume nomeado `review-bot-data`:

   ```bash
   docker compose run --rm --no-deps \
     -v "$(pwd)/backups:/backups:ro" \
     app sh -c 'rm -f /data/review-bot.db /data/review-bot.db-wal /data/review-bot.db-shm && cp /backups/review-bot-<timestamp>.db /data/review-bot.db'
   ```

   No Windows PowerShell, use `${PWD}` no lugar de `$(pwd)` e confira o volume `review-bot-data` com `docker volume ls`.

3. Se a instância usa a chave em arquivo, restaure-a com permissão `0600`:

   ```bash
   docker compose run --rm --no-deps \
     -v "$(pwd):/host:ro" \
     app sh -c 'cp /host/chave-encryption-key /data/.encryption-key && chmod 600 /data/.encryption-key'
   ```

   Se a instância usa `APP_ENCRYPTION_KEY`, defina a mesma chave no ambiente; não crie o arquivo.

4. Suba novamente e valide:

   ```bash
   docker compose start app
   docker compose logs -f app
   curl -fsS https://<seu-host>/healthz
   ```

5. Confirme login, dashboard, fila e uma review recente. As migrations rodam no boot; se o backup for de uma versão anterior, use a imagem correspondente ao schema antes de aplicar upgrades.

**Observações importantes:**

- A chave de criptografia precisa ser a mesma do backup: `APP_ENCRYPTION_KEY` ou a `.encryption-key` correspondente. Se a chave estiver ausente e houver segredos cifrados, o container não inicia; com outra chave, o banco abre, mas PAT, chaves de IA e secrets de webhook ficam ilegíveis.
- Não copie o arquivo do banco com o container em execução sem usar a API de backup: o WAL pode estar ativo.
- Mantenha cópias fora do host e teste a restauração periodicamente em ambiente descartável.

### Redefinir senha

```bash
docker compose exec app node scripts/reset-password.mjs <username>
```

O script procura o usuário (normalizado para minúsculas), lê a nova senha do **stdin** com mínimo de 12 caracteres, atualiza o hash Argon2id, revoga as sessões do usuário e registra `user.password_reset` na auditoria. Em terminal interativo a senha é exibida durante a digitação. Para automação:

```bash
printf '%s\n' "$NOVA_SENHA" | docker compose exec -T app node scripts/reset-password.mjs <username>
```

Evite manter a senha no histórico do shell. A senha também pode ser alterada pela interface (com a senha atual) ou por um root na gestão de usuários; o script é o caminho de recuperação quando não há acesso ao painel.

### Upgrade

1. Faça backup e guarde o arquivo fora do host.
2. Atualize o código (`git pull`) ou a imagem publicada.
3. Reconstrua e suba:

   ```bash
   docker compose build --pull
   docker compose up -d
   ```

   Se usar uma imagem de registry, troque o build por `docker compose pull`.
4. Acompanhe os logs e valide `/healthz` e `/readyz`.

As migrations são aplicadas no boot e não há downgrade automático. Se uma migration falhar, o container não inicia: restaure o backup e volte para a versão anterior da imagem. Faça upgrades em janela de manutenção quando houver jobs em execução; jobs `running` são devolvidos para `queued` no próximo boot.

#### Instalações do Plano 3 (volume `data` e `.env` antigo)

O Plano 3 usava um volume `data` prefixado pelo projeto Compose (por exemplo, `<projeto>_data`), `PORT=3000` e `APP_ENCRYPTION_KEY` no `.env`. O Plano 4 usa o volume fixo `review-bot-data` e `PORT=7080`.

1. Faça backup do banco antigo e guarde a chave (`APP_ENCRYPTION_KEY` e/ou `.encryption-key`) fora do repositório, com permissão `600` na cópia em arquivo.
2. Pare a stack antiga (`docker compose down`) e identifique o volume prefixado:

   ```bash
   docker volume ls
   ```

3. Crie o volume fixo e copie o conteúdo antigo (banco, WAL/SHM, backups e eventual `.encryption-key`):

   ```bash
   docker volume create review-bot-data
   docker run --rm \
     -v <projeto>_data:/from:ro \
     -v review-bot-data:/to \
     alpine sh -c 'cp -a /from/. /to/'
   ```

4. Mantenha o mesmo `APP_ENCRYPTION_KEY` no `.env` novo ou migre para a chave em arquivo, copiando o valor original para o volume:

   ```bash
   printf '%s' "$APP_ENCRYPTION_KEY" > chave-encryption-key
   chmod 600 chave-encryption-key
   docker run --rm \
     -v "$PWD/chave-encryption-key:/host/key:ro" \
     -v review-bot-data:/data \
     alpine sh -c 'cp /host/key /data/.encryption-key && chmod 600 /data/.encryption-key'
   ```

   No PowerShell, use `${PWD}` no lugar de `$PWD`. Se mantiver a variável de ambiente, não crie o arquivo.

5. Atualize `PORT` e `PUBLIC_URL` juntos: o padrão antigo era `3000` e o novo é `7080`. Se o proxy ainda aponta para `3000`, ajuste o proxy para `7080` ou defina `PORT=3000`; se `PUBLIC_URL` estava em `http://localhost:3000`, atualize para `http://localhost:7080` (ou para a URL pública HTTPS real).
6. Suba a nova stack e valide login, fila, uma review recente e a publicação:

   ```bash
   docker compose up -d
   docker compose logs -f app
   ```

O volume antigo `<projeto>_data` é deixado intacto; remova-o manualmente com `docker volume rm <projeto>_data` somente depois de validar a migração.

## Release

Cada tag `v*` dispara `.github/workflows/release.yml`, que constrói e publica a imagem multi-arquitetura (`linux/amd64` e `linux/arm64`) no GHCR:

```text
ghcr.io/<owner>/review-bot:<tag>
ghcr.io/<owner>/review-bot:latest
```

A release anexa três arquivos: `docker-compose.yml` com a imagem da tag já fixada, `.env.example` e `SHA256SUMS`. Baixe-os, confira o checksum e suba sem build local:

```bash
docker compose -f docker-compose.yml up -d
```

O compose da release usa o mesmo volume nomeado `review-bot-data`, a porta `${PORT:-7080}` e as mesmas variáveis opcionais do compose de desenvolvimento. Para atualizar depois de uma nova tag, substitua o `docker-compose.yml` pelo da nova release e execute `docker compose pull && docker compose up -d`.

Para gerar uma imagem multi-arquitetura localmente, sem publicar:

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t review-bot:latest .
```

Acrescente `--push` para publicar em um registry; `--load` só funciona com uma única plataforma. A imagem runtime roda como usuário `node`, copia `scripts/` e mantém `/data` com ownership de `node`.

## Runbook de falhas

| Sintoma / código | Causa provável | Ação |
|---|---|---|
| 401 ou 403 no polling | PAT revogado, expirado, sem escopo ou sem acesso ao repositório | Valide em **Definições > GitHub**; gere um novo PAT e salve. Três falhas consecutivas pausam o poller e disparam `poller.paused`. Salvar uma credencial válida limpa a pausa e o contador. |
| 403 em job | Escopo insuficiente, repositório privado sem acesso ou organização com SSO | Corrija as permissões do PAT, autorize o SSO e use **Reprocessar**. Falhas permanentes não são repetidas automaticamente. |
| 404 em job ou enfileiramento | Repositório removido, renomeado ou fora do escopo do token | Confirme `owner/repo` e o acesso do PAT. |
| 429 do GitHub | Rate limit primário ou secundário | O job é reagendado respeitando `Retry-After` ou `x-ratelimit-reset`; sem cabeçalho, a espera é de 30 s e 2 min entre as tentativas. Reduza concorrência e intervalo de polling; evite vários jobs simultâneos no mesmo token. |
| 429 do provedor de IA | Limite de requisições/minuto do provedor | O job é reagendado (30 s e 2 min entre as tentativas); verifique o plano e o limite do provedor. Reduza a concorrência ou use um perfil/modelo com mais capacidade. |
| 5xx, timeout ou erro de rede do provedor | Indisponibilidade, URL/modelo inválido, timeout de 120 s por chamada | O job tenta novamente até 3 vezes. Teste o perfil em **Definições > IA**; confira URL base, modelo, chave e status do provedor. Depois use **Reprocessar**. |
| Conteúdo inválido do provedor | Saída sem `submit_review` ou JSON/ferramenta inválida | O loop tenta um fechamento forçado; depois o job fica `partial` ou `failed`. Ajuste o modelo/pre-prompt e reprocesse. |
| 422 na publicação | Posição de comentário rejeitada pelo GitHub | A publicação é refeita automaticamente sem comentários inline e os achados vão para o corpo (`fallback`). Não é necessária ação; investigue se persistir. |
| Publicação falhou | Erro transitório, PAT sem escrita em PR ou review duplicada | Verifique o erro no job e no histórico da review; corrija o PAT e use **Reprocessar** ou **Republicar** no detalhe. O marcador evita duplicar reviews. |
| Disco cheio | Volume `/data` esgotado por banco, WAL ou backups | Pare o container, libere espaço (copie/remova backups antigos e imagens não usadas), aumente o volume e suba de novo. Não apague o banco nem os arquivos `-wal`/`-shm` manualmente com o app rodando. |
| `database is locked` | Concorrência alta ou processo externo escrevendo no SQLite | Use concorrência 1, mantenha uma única réplica e não abra o banco para escrita fora da aplicação. O `busy_timeout` é de 5 s. |
| Migration falhou no boot | Schema incompatível, imagem errada ou banco corrompido | Leia `docker compose logs app`; restaure o backup e use a imagem correspondente. Não tente "consertar" o schema manualmente. |
| Fila pausada | Ação manual em **Fila > Pausar** | Use **Retomar**. A pausa da fila é separada da pausa do poller. |
| Poller pausado | Três falhas de autenticação consecutivas | Salve um PAT válido em **Definições > GitHub**; isso limpa `poller_paused` e o contador. Confirme o evento `poller.paused` na timeline e o webhook. |
| Webhook não entregue | URL bloqueada por SSRF, secret incorreto, timeout ou indisponibilidade | Veja o histórico de entregas; valide a URL, o secret e o status. URLs privadas exigem `ALLOW_PRIVATE_URLS=true`. São 3 tentativas (0 s, 1 s, 5 s) com timeout de 10 s. |
| Webhook `job.failed` não entregue | URL bloqueada por SSRF, secret incorreto, timeout ou indisponibilidade | Veja o histórico de entregas; valide a URL, o secret e o status. O worker dispara `job.failed` ao esgotar as tentativas. URLs privadas exigem `ALLOW_PRIVATE_URLS=true`. |
| Job travado em `running` | Processo encerrado sem shutdown ou worker sem heartbeat | Reinicie o container; o boot devolve jobs `running` para `queued`. O heartbeat de 30 s e o `busy_timeout` reduzem a janela de travamento. |
| Review sem comentários inline | Todos os achados estavam fora do diff ou o GitHub rejeitou posições | Verifique o status dos achados (`outside_diff`/`fallback`) e o corpo do review em **Reviews**. A review pode estar `posted` com os achados apenas no corpo. |
| Setup já concluído | Token usado após o root existir | O setup é permanente. Use login normal; se perdeu a senha, use o script de reset. O token só aparece no wizard `/setup`; se perdê-lo antes de concluir, defina `SETUP_TOKEN` e reinicie ou recrie o volume de dados ainda não configurado. |

### Recuperação de desastre

1. Provisione um host com Docker e a mesma chave de criptografia (`APP_ENCRYPTION_KEY` ou a `.encryption-key` restaurada) e as demais variáveis do `.env`, se usadas.
2. Restaure o backup conforme a seção anterior.
3. Suba a mesma versão da imagem usada no backup.
4. Valide `/healthz`, login, fila, um job recente e a publicação em um repositório de teste.
5. Se a chave de criptografia foi perdida e existem segredos cifrados, o container não inicia até que uma chave seja fornecida. Restaure a chave original do backup. Se ela não existir mais, inicie com uma chave nova e recadastre PAT, chaves de IA e secrets; reviews e histórico continuam legíveis, mas os segredos antigos ficam ilegíveis. Os comandos para os modos arquivo e ambiente estão em **Rotação e perda de segredos**.

### Rotação e perda de segredos

- **PAT ou chave de IA:** salve um novo valor em **Definições > GitHub** ou **Definições > IA**. O valor anterior é substituído.
- **Secret de webhook:** edite o webhook e informe um novo secret, ou recrie o webhook.
- **Chave de criptografia:** não há rotação automática. Trocar `APP_ENCRYPTION_KEY` ou a `.encryption-key` invalida os segredos existentes; recadastre-os depois da troca. Guarde a chave em um gerenciador de segredos e faça backup separado.
  - **Modo arquivo (`DATA_DIR/.encryption-key`):** restaure a cópia guardada ou, se ela não existir mais, gere uma chave nova. Em ambos os casos, grave o arquivo no volume com permissão `600`:

    ```bash
    # restaurar a cópia original (ou, para chave nova: openssl rand -base64 32 > chave-encryption-key)
    chmod 600 chave-encryption-key
    docker compose run --rm --no-deps \
      -v "$(pwd):/host:ro" \
      app sh -c 'cp /host/chave-encryption-key /data/.encryption-key && chmod 600 /data/.encryption-key'
    docker compose up -d
    ```

  - **Modo ambiente (`APP_ENCRYPTION_KEY`):** restaure o valor original no `.env`/gerenciador de segredos ou gere uma chave nova com `openssl rand -base64 32`, defina `APP_ENCRYPTION_KEY` e reinicie com `docker compose up -d`.
  - Com uma chave nova, recadastre PAT, chaves de IA e secrets de webhook em **Definições**; reviews, jobs e histórico continuam legíveis.

## Checklist de aceite AC-01..AC-13

**Status geral: PENDENTE (execução manual no VPS).** Use um repositório de teste e uma conta GitHub dedicada. Não execute os passos destrutivos em produção. Para cada item, registre a data, o operador, a versão/imagem, os IDs de job/review e os trechos de log ou URLs das reviews.

### AC-01 — Setup e token

**Critério:** em instalação limpa, o setup exige o token exibido no wizard; token errado é rejeitado; root é criado; novas tentativas de setup passam a ser rejeitadas (409).

1. Em um host/volume vazio, o `.env` é opcional. Se quiser um token conhecido, defina `SETUP_TOKEN`; caso contrário, deixe o wizard gerar o token.
2. Suba com `docker compose up -d` e abra `/setup`. O token gerado aparece no campo do próprio wizard e não é escrito no log.
3. Tente um token incorreto e confirme a mensagem de token inválido (HTTP 401).
4. Informe o token correto, usuário root e senha com 12 ou mais caracteres. Confirme a entrada no dashboard.
5. Tente novamente `POST /api/setup` com o token antigo e confirme HTTP 409 `setup_already_complete`; o setup não pode ser repetido. A verificação é o 409 da segunda chamada, não um redirecionamento automático de `/setup`.

**Evidência esperada:** captura do wizard com o token (sem expor o valor no relatório), captura do erro e do sucesso, status 409 da segunda tentativa.

### AC-02 — PAT

**Critério:** é possível salvar e testar o PAT; o login da conta é exibido; o token nunca retorna pela API.

1. Gere um PAT fine-grained ou classic com os escopos descritos no README.
2. Em **Definições > GitHub**, salve o PAT com **Salvar e testar**. Confirme o login e os 4 últimos caracteres do token (`patLast4`) exibidos.
3. Use **Salvar e testar** novamente ou `POST /api/settings/github/test` e confirme `{ ok: true, login, scopes }`; a tela da v1 não exibe os escopos.
4. Inspecione `GET /api/settings/github`: deve conter apenas `login`, `patLast4` e `scopes`, nunca o PAT completo. A tela exibe `login` e `patLast4`; os escopos ficam na resposta da API de teste.
5. Confirme no banco que `github_credentials.pat_encrypted` é ciphertext (não começa com `ghp_`/`github_pat_`).

**Evidência esperada:** captura da tela, resposta da API sem o token e consulta ao campo cifrado.

### AC-03 — Review publicada

**Critério:** um review request gera job em até dois ciclos de polling e publica um review com resumo e comentários inline válidos.

1. Em um repositório de teste, crie uma PR com uma alteração que contenha pelo menos um problema técnico verificável.
2. Solicite o review da conta do bot. Não use PR da própria conta do bot e não a deixe como rascunho se `ignoreDrafts` estiver ativo.
3. Com o intervalo padrão de 60 s, aguarde até dois ciclos (cerca de 2 minutos) e confirme o job em **Fila**.
4. Abra a PR no GitHub e confirme o review `COMMENT`, com resumo em Markdown e comentários inline ancorados em linhas do diff.
5. Confirme que o review tem o marcador `<!-- pr-reviewer:job:... -->` e que o bot não enviou `APPROVE` nem `REQUEST_CHANGES`.

**Evidência esperada:** URL da PR/review, job id, captura da timeline e do review.

### AC-04 — Novo commit sem duplicação

**Critério:** um novo commit com novo request gera novo job; o SHA anterior não é republicado. Re-polling não duplica.

1. Após o AC-03, faça um novo commit na mesma PR e solicite novamente o review da conta do bot.
2. Aguarde um ciclo e confirme um novo job com `head_sha` diferente e `run_seq = 1` para esse SHA.
3. Confirme que a review anterior permanece intacta e que o novo review foi publicado no novo commit.
4. Aguarde mais um ciclo de polling sem alterações e confirme que nenhum job adicional foi criado para o mesmo SHA.
5. Repita o polling e verifique que não há reviews duplicadas com o mesmo marcador.

**Evidência esperada:** dois jobs com SHAs distintos, duas reviews (uma por SHA), contagem estável após re-polling.

### AC-05 — Falha do provedor, retries, webhook e retry manual

**Critério:** falha 500 do provedor gera retries; ao esgotar, o job fica `failed`, o webhook dispara e o retry manual publica sem duplicatas.

1. Em ambiente descartável, configure um perfil de IA apontando para um stub HTTP que responda 500 (se o stub estiver em rede privada, use `ALLOW_PRIVATE_URLS=true` temporariamente).
2. Cadastre um webhook para o evento `job.failed` e enfileire uma PR manualmente em **Fila**. Acompanhe o job e confirme até 3 tentativas, com os eventos `job.retry_scheduled` e esperas de 30 s e 2 min entre elas (cerca de 2,5 minutos no total).
3. Ao esgotar, confirme o status `failed`, o evento `job.failed` na timeline e uma entrega HTTP bem-sucedida do webhook `job.failed` no histórico de entregas.
4. Troque o perfil para um provedor funcional e use **Reprocessar** no job.
5. Confirme a publicação de exatamente uma review para o job/SHA, sem duplicar a review anterior. Verifique o marcador e a lista de reviews da PR.

**Evidência esperada:** timeline com tentativas, status `failed`, entrega do webhook `job.failed` e review publicada após o retry. O aceite continua pendente de execução manual em VPS.

### AC-06 — Achado fora do diff

**Critério:** achado em linha fora do diff é movido para o corpo e o review é publicado.

1. Use um stub de provedor que retorne uma chamada `add_finding` com path válido e linha fora dos hunks da PR, seguida de `submit_review`.
2. Enfileire a PR e aguarde a publicação.
3. Confirme que a review foi publicada (sem laço de 422) e que o achado aparece no corpo, na seção `Achados sem linha no diff`, com `arquivo:linha`.
4. Confirme no detalhe da review que o achado está com status de fallback e que a review não ficou `failed`.

**Evidência esperada:** URL do review e captura do corpo com o achado de fallback; logs sem erro 422 repetido.

### AC-07 — Pausa por falha de autenticação

**Critério:** três falhas de autenticação consecutivas pausam o poller e disparam `poller.paused`.

1. Com um PAT válido configurado, revogue o token na conta do GitHub (ou faça-o expirar).
2. Aguarde três ciclos de polling (cerca de 3 minutos no intervalo padrão). Confirme o evento `poller.paused` e a entrega do webhook `poller.paused`.
3. Confirme que o poller deixou de criar jobs e que o dashboard/health reflete a pausa quando disponível.
4. Gere um novo PAT, salve em **Definições > GitHub** e confirme que a pausa e o contador são limpos; aguarde o próximo ciclo e valide que o polling voltou a funcionar.

**Evidência esperada:** logs com três falhas, evento/webhook de pausa e retomada após novo PAT. A pausa da fila (`queue_paused`) é independente.

### AC-08 — RBAC

**Critério:** `viewer` não muta nada; `operator` reprocessa jobs mas não altera credenciais; `admin` gerencia tudo; o último admin não pode ser removido.

1. Crie um usuário `viewer`, um `operator` e um `admin` adicional (somente o root cria administradores).
2. Com `viewer`: confirme que chamadas de mutação (pause, enqueue, cancel, retry, credenciais e perfis) retornam 403. Botões de escrita podem aparecer na UI; o bloqueio efetivo é o 403 da API. Confirme também que a rota de **Definições** mostra acesso restrito (o item de menu é oculto para não-admin).
3. Com `operator`: confirme que pausa, enfileira, cancela e reprocessa jobs; confirme 403 ao tentar salvar PAT, perfil de IA, webhook ou usuário.
4. Com `admin`: confirme a gestão de repositórios, perfis, skills, fila, usuários, webhooks e sistema, exceto alterações no root.
5. Tente remover/desabilitar o último administrador não-root e confirme HTTP 409 `last_admin`. Confirme também que o root é imutável.

**Evidência esperada:** matriz de respostas 200/403/409 por papel e capturas das telas.

### AC-09 — Segredos cifrados e logs redigidos

**Critério:** segredos aparecem cifrados no banco e redigidos nos logs.

1. Cadastre PAT, chave de IA e secret de webhook.
2. Consulte a API correspondente e confirme que os valores completos não retornam (apenas `hasApiKey`, `patLast4`, etc.).
3. Inspecione o banco em modo somente leitura:

   ```bash
   docker compose exec app node -e "const D=require('better-sqlite3');const db=new D('/data/review-bot.db',{readonly:true});console.log(db.prepare('SELECT pat_encrypted, pat_last4 FROM github_credentials').get());console.log(db.prepare('SELECT api_key_encrypted FROM ai_profiles').all());console.log(db.prepare('SELECT secret_encrypted FROM webhooks').all())"
   ```

   Os campos `*_encrypted` devem ser ciphertext, não os valores originais.
4. Procure os valores do PAT, da chave de IA e do secret de webhook em `docker compose logs app` e confirme que não aparecem; campos conhecidos (`authorization`, `cookie`, `token`, `password`, `apiKey`) são redigidos. O token de setup também não aparece no log: ele é exibido somente no wizard `/setup` antes da conclusão.
5. Verifique que os backups também contêm apenas os valores cifrados.

**Evidência esperada:** saída da consulta sem segredos em claro e busca nos logs sem correspondência.

### AC-10 — Retenção

**Critério:** a rotina de retenção remove transcrições e eventos antigos e preserva reviews.

1. No host de build/CI (não dentro da imagem runtime, que não tem Bun), registre a cobertura automatizada com `bun run test tests/unit/retention.test.ts` (ou a suíte completa) como evidência complementar.
2. Em ambiente descartável, configure **Definições > Sistema > Retenção de logs** para 1 dia e gere jobs/eventos/transcrições.
3. Aguarde a execução diária da retenção (o timer roda 24 h após o start; não há botão manual) e confirme no log `retenção executada` com contagens.
4. Confirme que transcrições, eventos, entregas de webhook e cache vencido além do prazo foram removidos, enquanto jobs, reviews, achados e auditoria recente permanecem.
5. Confirme que a auditoria mantém 180 dias independentemente do prazo configurado.

**Evidência esperada:** log da retenção, contagens antes/depois e reviews ainda acessíveis. Para uma janela curta, use o teste automatizado e uma cópia descartável do banco como evidência; o aceite manual no VPS pode exigir aguardar o ciclo diário.

### AC-11 — Cancelamento

**Critério:** cancelar um job em execução não publica review e o estado fica `cancelled`.

1. Use um stub de provedor lento ou uma PR grande para manter o job em `running` por tempo suficiente.
2. Em **Fila**, clique em **Cancelar** enquanto o job estiver `running`.
3. Confirme o status `cancelled` e a ausência de nova review na PR. O evento `job.finished` de cancelamento pode aparecer quando o worker percebe o cancelamento durante o loop; o critério principal é o estado e a não publicação.
4. Aguarde a resposta do provedor (se o stub continuar) e confirme que o worker não publica nada após o cancelamento.
5. Confirme que o job cancelado não volta para a fila sozinho e que **Reprocessar** só o enfileira se for acionado manualmente.

**Evidência esperada:** status/timeline do job e lista de reviews da PR inalterada.

### AC-12 — PR sem achados

**Critério:** PR sem achados recebe um review-resumo informando que não há problemas relevantes.

1. Crie uma PR de teste com uma alteração simples e correta, sem problemas técnicos relevantes.
2. Solicite o review da conta do bot e aguarde a publicação.
3. Confirme que a review foi publicada com `event=COMMENT`, resumo informando que não foram encontrados problemas relevantes e nenhum comentário inline.
4. Confirme que o bot não aprovou a PR.

**Evidência esperada:** URL da review e captura do resumo/evento.

### AC-13 — Forçar nova execução

**Critério:** forçar uma nova execução de um SHA já revisado cria um job com `run_seq` incrementado, publica um novo review e mantém o histórico anterior intacto.

1. Após uma review publicada, abra **Fila > Enfileirar PR**, informe o mesmo `owner/repo` e número de PR e marque **Forçar**.
2. Confirme a criação de um novo job para o mesmo SHA com `run_seq` incrementado (por exemplo, 2).
3. Aguarde a publicação e confirme um novo review para o mesmo commit, com marcador de job diferente.
4. Confirme que a review anterior continua acessível e inalterada, com seus achados e histórico.
5. Repita o enfileiramento sem **Forçar** e confirme HTTP 409 `job_exists`, sem novo job.

**Evidência esperada:** dois jobs com o mesmo SHA e `run_seq` distintos, duas reviews no GitHub, histórico preservado e conflito sem `force`.

## Registro da execução final

Preencha ao executar o checklist no VPS:

| Campo | Valor |
|---|---|
| Data e hora | |
| Operador | |
| Versão / imagem (tag ou digest) | |
| URL pública | |
| Repositório de teste | |
| Provedor/modelo de IA | |
| Resultado AC-01..AC-13 | Pendente / Aprovado / Falho (detalhar) |
| Incidentes e observações | |

O aceite final não é considerado concluído até que todos os itens tenham evidência registrada e as falhas tenham sido corrigidas ou aceitas formalmente.
