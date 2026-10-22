# Agente de Review de PRs — Requisitos e Design

- **Projeto:** review-bot (`D:\projetos\review-bot`)
- **Data:** 2026-10-22
- **Status:** Aguardando revisão do usuário
- **Versão:** 1.0

## 1. Contexto

Sistema novo, auto-hospedado em um servidor/VPS, que automatiza code review de Pull Requests do GitHub. O operador instala o sistema, define o usuário root no primeiro acesso e configura uma conta GitHub e um provedor de IA pelo painel. A partir daí, sempre que a conta configurada for adicionada como revisora de uma PR, o sistema enfileira a PR, analisa o código com um agente de IA e publica um review com comentários inline, de forma semelhante ao GitHub Copilot Code Review.

O escopo original menciona "usar o git bash". A decisão de requisitos foi usar **somente a API do GitHub** como fonte de código e contexto. Consequência: não há clone de repositório, não há git instalado no servidor e nenhum comando de shell é executado pelo agente. A análise usa metadados, diffs, arquivos e busca de código via API.

O prompt de review anexado (`review-pr.md`) serve de referência de comportamento: análise técnica direta, Markdown, severidades, comentários inline e submissão de um review. Elementos incompatíveis com automação (aprovação manual antes de publicar, comandos `gh`/`git` locais, validação de arquivo temporário UTF-8) são substituídos conforme este documento.

## 2. Objetivos

- Detectar automaticamente review requests feitos à conta GitHub configurada.
- Produzir uma review técnica acionável, com resumo e comentários inline em linhas válidas do diff.
- Publicar a review sem intervenção humana, com idempotência e sem duplicar comentários.
- Oferecer um painel protegido por senha para acompanhar fila, reviews, consumo e configurações.
- Ser instalável e operável em um único VPS com Docker Compose, sem serviços externos obrigatórios.
- Proteger credenciais e limitar custo/consumo por review.

### Critérios de sucesso

- Uma review request é detectada em no máximo dois ciclos de polling e publicada sem duplicatas.
- Falhas são visíveis no painel e reprocessáveis sem efeitos colaterais duplicados.
- Instalação completa com `docker compose up -d` e um token de setup lido no log.
- Segredos nunca retornam pela API nem aparecem em logs.

## 3. Atores e permissões

| Ator | Descrição | Permissões |
|---|---|---|
| Root | Primeiro usuário criado no setup; é um admin especial | Tudo; não pode ser removido nem rebaixado; único que pode gerenciar outros admins |
| Admin | Usuário criado pelo root | Gerencia repositórios, perfis de IA, skills, webhooks, fila, usuários e configurações |
| Operator | Usuário operacional | Pausa/retoma fila, cancela e reprocessa jobs, publica reviews pendentes; não altera credenciais nem configurações |
| Viewer | Usuário somente leitura | Visualiza dashboard, fila, reviews, logs e métricas |
| Conta GitHub | Identidade do bot, autenticada por PAT | Recebe review requests e publica comentários como o dono do token |
| Solicitante | Colaborador do repositório que pede review | Não acessa o painel; interage apenas pelo GitHub |

## 4. Requisitos funcionais

- **RF-01 — Setup inicial:** no primeiro boot, o sistema gera um token de setup, armazena apenas seu hash e o imprime uma única vez no log. A rota de setup exige esse token e cria o root com senha. Após a criação, a rota é permanentemente desabilitada. Se o container reiniciar antes do setup, o token não é regenerado; o operador pode definir `SETUP_TOKEN` no ambiente para substituí-lo ou recriar o volume.
- **RF-02 — Autenticação:** login por usuário e senha; sessão em cookie `httpOnly`; logout; troca de senha. Sessões são revogáveis.
- **RF-03 — Gestão de usuários:** root/admin cria, edita, desativa e redefine senhas; papéis `admin`, `operator` e `viewer`. O último administrador ativo criado além do root não pode ser removido ou rebaixado; o root é imutável e não conta para essa regra.
- **RF-04 — Credencial GitHub:** o painel aceita usuário e Personal Access Token (PAT), valida a conexão e as permissões, e armazena o token cifrado. Apenas os quatro últimos caracteres são exibidos. Fine-grained: Metadata read, Contents read e Pull requests read/write; classic: escopo `repo`. Tokens fine-grained de organizações precisam de aprovação da org.
- **RF-05 — Escopo de repositórios:** o sistema considera todos os repositórios acessíveis pela conta do PAT, incluindo repositórios de organizações. Cada repositório descoberto pode ser desabilitado individualmente.
- **RF-06 — Polling:** consulta periódica (padrão 60 s, configurável) por PRs abertas com review request para a conta. Requisições usam cache condicional (ETag) quando aplicável.
- **RF-07 — Deduplicação:** uma PR é identificada por `(repositório, número, head_sha)`. Se já existe job para esse SHA, o polling ignora. Um novo SHA após novo request gera novo job. Falhas não são reenfileiradas automaticamente pelo polling; exigem retry manual.
- **RF-08 — Fila persistente:** jobs sobrevivem a reinícios; execução FIFO; concorrência padrão 1 (configurável entre 1 e 3); pausar/retomar polling e novos claims (job em execução continua); cancelar job em execução; reprocessar jobs falhos; enfileirar PR manualmente; nova execução de um SHA já revisado cria um novo job (`run_seq` incrementado) e preserva o histórico.
- **RF-09 — Análise com agente:** loop de tool calling próprio, independente de runtime externo, com pré-prompt, skills selecionadas e limites por perfil.
- **RF-10 — Ferramentas de leitura:** o agente acessa somente dados do GitHub por ferramentas read-only (metadados, arquivos, diff, árvore, commits, comentários existentes, busca de código). Nenhum shell, clone ou execução de código.
- **RF-11 — Limites por job:** turnos, tokens totais, tempo, número de achados e chamadas ao GitHub, configuráveis com padrões seguros. O consumo é registrado por job.
- **RF-12 — Validação de achados:** cada achado é validado contra o diff. Comentários inline só são enviados para linhas válidas do lado `RIGHT`; os demais viram seções no corpo do review.
- **RF-13 — Publicação automática:** ao concluir, o sistema publica um único review com `event=COMMENT`, resumo e comentários inline. Nunca aprova nem solicita mudanças.
- **RF-14 — Idempotência:** o review contém um marcador único do job. Antes de publicar, o sistema verifica se o marcador já existe; retries não duplicam reviews nem comentários.
- **RF-15 — Falhas e retry:** erros transitórios geram até 3 tentativas com backoff exponencial (30 s, 2 min, 8 min) respeitando `Retry-After`. Ao esgotar, o job fica `failed` e pode ser reprocessado manualmente.
- **RF-16 — Dashboard:** exibe fila ao vivo, job em execução, reviews recentes, falhas e métricas de tokens/duração, com atualização por SSE.
- **RF-17 — Histórico de reviews:** lista filtrável e detalhe com link da PR, status, snapshot do perfil, consumo, timeline, achados agrupados, transcrição e ações permitidas.
- **RF-18 — Perfis de IA:** CRUD de perfis com provedor, base URL, modelo, chave, temperatura, limites e pré-prompt; exatamente um perfil ativo. Teste de conexão por perfil.
- **RF-19 — Skills:** CRUD de skills em Markdown, associadas a perfis com ordenação; conteúdo anexado ao prompt de sistema.
- **RF-20 — Webhooks de saída:** URL, secret, eventos assinados com HMAC-SHA256, teste e histórico de entregas. Cabeçalhos `X-PRReviewer-Event` e `X-PRReviewer-Signature`; payload sem código ou segredos. Até 3 tentativas com backoff. Eventos: `review.published`, `job.failed`, `job.partial`, `poller.paused`.
- **RF-21 — Auditoria:** registro de ações administrativas com usuário, IP, alvo e timestamp.
- **RF-22 — Retenção:** limpeza periódica de transcrições, eventos e entregas de webhook após o prazo configurado (padrão 90 dias). Jobs, reviews, achados e métricas permanecem.
- **RF-23 — Idioma:** o agente escreve no idioma detectado na PR; se ambíguo, usa português do Brasil.
- **RF-24 — Saúde:** endpoints `/healthz` (processo e banco) e `/readyz` (poller e worker).
- **RF-25 — Redação de segredos:** achados são verificados contra padrões de tokens e chaves; segredos detectados são redigidos e nunca publicados.

## 5. Requisitos não funcionais

- **RNF-01 — Segurança:** senhas com Argon2id; segredos cifrados em repouso com AES-256-GCM; cookies `httpOnly`/`SameSite=Lax`; proteção CSRF por Origin; rate limit de login e setup; headers de segurança e CSP.
- **RNF-02 — Isolamento:** nenhuma execução de código do repositório; ferramentas estritamente read-only; chamadas de IA apenas para a base URL configurada.
- **RNF-03 — Privacidade:** a UI informa que diffs, arquivos e metadados são enviados ao provedor de IA; logs não contêm segredos.
- **RNF-04 — Desempenho:** detecção em até 2 ciclos de polling; processamento de uma PR típica em até 10 minutos; painel responde em menos de 300 ms para consultas locais.
- **RNF-05 — Robustez:** jobs persistem entre reinícios; jobs órfãos são recuperados; publicação é idempotente.
- **RNF-06 — Portabilidade:** imagem Docker única; SQLite como único armazenamento; funciona em `linux/amd64` e `linux/arm64`.
- **RNF-07 — Operabilidade:** configuração por variáveis de ambiente e painel; migrations automáticas; backup documentado; healthchecks.
- **RNF-08 — Manutenibilidade:** TypeScript estrito, validação com zod nas fronteiras, testes automatizados nos caminhos críticos.
- **RNF-09 — Acessibilidade:** navegação por teclado, foco visível, contraste adequado e rótulos em formulários.
- **RNF-10 — Idioma da UI:** português do Brasil.

## 6. Decisões e premissas

| Decisão | Escolha | Justificativa |
|---|---|---|
| Gatilho | Polling da API do GitHub | Não exige webhook público nem HTTPS de entrada |
| Autenticação GitHub | PAT do usuário | GitHub não aceita senha de conta para API |
| Escopo | Todos os repos acessíveis, incluindo orgs | Atende ao requisito; descoberta sob demanda |
| Publicação | Automática, `event=COMMENT` | Comportamento tipo Copilot; bot não bloqueia merge |
| Engine | Loop agêntico próprio via API | Controle de ferramentas, custo e portabilidade |
| Acesso ao código | Somente API do GitHub | Sem clone, git ou shell no servidor |
| Stack | TypeScript/Node.js | Ecossistema de IA/GitHub e produtividade |
| Arquitetura | Monólito modular em um container | Menor custo operacional para um VPS |
| Banco | SQLite (WAL) + Drizzle | Suficiente para 1 instância e 1–3 jobs |
| Implantação | Docker Compose | Instalação reproduzível |
| TLS | Proxy do operador | Decisão do usuário; app não termina TLS |
| Setup | Token impresso no log | Evita sequestro do root |
| Idioma | Detecção pela PR, fallback PT-BR | Repositórios mistos |
| Tema da UI | Escuro (slate-950/900, bordas slate-800) | Mockups aprovados em `design/review-bot-mockups.figcraft` |
| Notificações | Webhook genérico | Integração simples com Discord/Slack/n8n |
| Custo | Tokens e duração, sem preço | Evita manter tabela de preços volátil |

Premissas:

- Uma única conta GitHub por instalação.
- Uma única instância do sistema; múltiplas réplicas não são suportadas nesta versão.
- A conta do PAT tem acesso aos repositórios no momento do request; mudanças de permissão resultam em 403/404 tratados como erro permanente.
- Provedores suportados: OpenAI-compatible (OpenAI, DeepSeek, OpenRouter, opencode Zen) e Anthropic Messages. A base URL é editável; a URL exata do opencode Zen é confirmada na implementação.
- O sistema publica como o dono do PAT.
- Não há cálculo de custo monetário nesta versão.

## 7. Arquitetura

Monólito modular executado em um único processo Node.js. O servidor HTTP e o worker compartilham o mesmo SQLite.

```
+-------------------------------------------------------------+
| Container                                                   |
|                                                             |
|  Fastify (HTTP/API/SSE/SPA)      Poller loop                |
|        |                              |                     |
|        +----------+-------------------+                     |
|                   v                                         |
|            Serviços de aplicação                            |
|   auth | jobs | reviews | settings | webhooks | audit       |
|                   |                                         |
|        +----------+-----------+                             |
|        v                      v                             |
|   Worker (1..3)          GitHub client                      |
|   Agent loop             (REST + ETag cache)                 |
|   Provider adapters                                         |
|                   |                                         |
|                   v                                         |
|              SQLite (WAL)  <--- volume /data                |
+-------------------------------------------------------------+
```

Componentes:

- **http:** Fastify, rotas REST, SSE, SPA estática, sessões, RBAC, CSRF e rate limit.
- **poller:** loop de polling, deduplicação e enfileiramento; detecta repositórios arquivados e PRs da própria conta.
- **queue/worker:** claim atômico, heartbeat, recuperação de jobs órfãos, cancelamento cooperativo e shutdown gracioso.
- **agent:** montagem de prompt, loop de tool calling, validação incremental de achados e fechamento forçado.
- **providers:** adaptadores normalizados para OpenAI-compatible e Anthropic; traduzem ferramentas, uso de tokens e erros.
- **github:** cliente REST, cache ETag, ferramentas de leitura, parser de hunks, publicação e verificação de idempotência.
- **db:** Drizzle ORM, migrations no boot, repositórios tipados.
- **web:** SPA React.

### Stack

- Node.js 22, TypeScript estrito.
- Fastify, `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit`, `@fastify/helmet`.
- SQLite com `better-sqlite3`, Drizzle ORM e Drizzle Kit.
- React 19, Vite, React Router, TanStack Query, Tailwind CSS e Radix UI.
- Zod para validação; Pino para logs; Vitest para testes; Playwright para E2E.
- Argon2id via `@node-rs/argon2`.

### Estrutura de pastas

```
src/
  server.ts
  config.ts
  db/
  auth/
  github/
  ai/
    adapters/
  jobs/
  webhooks/
  api/
  web/
  shared/
scripts/
  backup.mjs
  reset-password.mjs
tests/
  unit/
  integration/
  e2e/
```

### Ciclo de vida

1. Boot: valida env, abre o banco, aplica migrations, garante token de setup, inicia HTTP, poller e worker.
2. Shutdown (SIGTERM): para de aceitar jobs, aborta chamadas em andamento, devolve jobs ao estado `queued` sem penalizar tentativas e fecha o banco.
3. Reinício: jobs `running` com heartbeat maior que 2 minutos são reenfileirados e a tentativa é incrementada.

## 8. Modelo de dados

IDs UUIDv7 (texto). Datas em epoch ms. Valores monetários não são armazenados.

| Tabela | Campos principais |
|---|---|
| `users` | id, username único (normalizado), password_hash, role, is_root, disabled, created_at, updated_at, last_login_at |
| `sessions` | id, user_id, token_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at, ip, user_agent |
| `app_settings` | key (PK), value_json, updated_at; inclui `setup_complete`, `setup_token_hash`, polling, retenção, concorrência |
| `github_credentials` | id (singleton), login, pat_encrypted, pat_last4, scopes, validated_at, updated_at |
| `ai_profiles` | id, name único, provider, base_url, model, api_key_encrypted, temperature, max_output_tokens, max_turns, max_total_tokens, max_duration_sec, max_findings, max_github_calls, pre_prompt, is_active, created_at, updated_at |
| `skills` | id, name único, description, content_md, created_at, updated_at |
| `ai_profile_skills` | profile_id, skill_id, position; PK composta |
| `repositories` | id, github_id único, owner, name, full_name único, private, archived, enabled, discovered_at, updated_at |
| `jobs` | id, repository_id, pr_number, pr_title, pr_url, author_login, head_sha, base_sha, run_seq, status, priority, attempts, max_attempts, profile_id, profile_snapshot_json, queued_at, started_at, finished_at, heartbeat_at, locked_by, error_code, error_message, usage_json; único (repository_id, pr_number, head_sha, run_seq) |
| `reviews` | id, job_id único, github_review_id, url, body, event, comments_posted, comments_fallback, status, posted_at |
| `review_findings` | id, job_id, review_id, path, start_line, end_line, side, severity, title, body_md, suggestion_md, status, github_comment_id, created_at |
| `agent_messages` | id, job_id, seq, role, content_json, tool_name, tokens_in, tokens_out, created_at |
| `events` | id, job_id (nullable), level, type, message, data_json, created_at |
| `webhooks` | id, url, secret_encrypted, events_json, enabled, created_at, updated_at |
| `webhook_deliveries` | id, webhook_id, event, success, status_code, attempt, response_excerpt, created_at |
| `audit_log` | id, user_id, action, target_type, target_id, data_json, ip, created_at |
| `github_cache` | key (PK), etag, payload_json, expires_at |

Índices relevantes: `jobs(status, queued_at)`, `jobs(repository_id, pr_number, head_sha, run_seq)` único, `events(job_id, created_at)`, `agent_messages(job_id, seq)`, `review_findings(job_id, status)`, `reviews(job_id)` único, `webhook_deliveries(webhook_id, created_at)`, `audit_log(created_at)`.

Status de job: `queued → running → succeeded | partial | failed | cancelled`. `failed → queued` por retry manual; `running → queued` por recuperação de órfão ou shutdown. `cancelled` não publica.

Cada linha de `jobs` representa uma execução. O polling só cria um job se não existir nenhum para `(repo, PR, SHA)`; uma nova execução manual cria outro job com `run_seq` incrementado. Reviews, achados, mensagens e eventos referenciam o job e, portanto, ficam isolados por execução.

Status de publicação: `posted`, `fallback` (achados no corpo), `failed`. Achados: `valid`, `outside_diff`, `duplicate`, `posted`, `fallback`, `rejected`.

## 9. API HTTP

Formato de erro: `{ "error": { "code": "...", "message": "...", "details": ... } }`. Paginação por `page` e `limit` (máximo 100).

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| GET | `/api/setup/status` | público | Indica se o setup é necessário |
| POST | `/api/setup` | token de setup | Cria o root e encerra o setup |
| POST | `/api/auth/login` | público | Autentica e cria sessão |
| POST | `/api/auth/logout` | autenticado | Encerra a sessão |
| GET | `/api/auth/me` | autenticado | Usuário e papel atuais |
| POST | `/api/auth/password` | autenticado | Troca a própria senha |
| GET | `/api/dashboard` | viewer+ | Métricas e resumo |
| GET | `/api/events` | viewer+ | SSE de atualizações |
| GET | `/api/repositories` | viewer+ | Repos descobertos |
| PATCH | `/api/repositories/:id` | admin | Habilita/desabilita repo |
| GET | `/api/jobs` | viewer+ | Lista com filtros de status, repo e data |
| POST | `/api/jobs` | operator+ | Enfileira PR manualmente; 409 se o SHA já tem job; `force=true` cria nova execução (`run_seq + 1`) |
| GET | `/api/jobs/:id` | viewer+ | Detalhe, timeline e uso |
| POST | `/api/jobs/:id/cancel` | operator+ | Cancela job |
| POST | `/api/jobs/:id/retry` | operator+ | Reprocessa job falho/cancelado |
| POST | `/api/jobs/:id/publish-review` | operator+ | Republica quando a publicação anterior falhou |
| GET | `/api/queue` | viewer+ | Estado e profundidade da fila |
| POST | `/api/queue/pause` | operator+ | Pausa polling e consumo |
| POST | `/api/queue/resume` | operator+ | Retoma |
| GET | `/api/reviews` | viewer+ | Lista de reviews |
| GET | `/api/reviews/:id` | viewer+ | Review, achados e transcrição |
| GET | `/api/settings/github` | admin | Credencial mascarada |
| PUT | `/api/settings/github` | admin | Salva credencial |
| POST | `/api/settings/github/test` | admin | Valida PAT e permissões |
| GET | `/api/ai-profiles` | admin | Lista perfis |
| POST | `/api/ai-profiles` | admin | Cria perfil |
| GET | `/api/ai-profiles/:id` | admin | Detalhe |
| PUT | `/api/ai-profiles/:id` | admin | Atualiza |
| DELETE | `/api/ai-profiles/:id` | admin | Remove (exceto o ativo em uso) |
| POST | `/api/ai-profiles/:id/activate` | admin | Ativa perfil |
| POST | `/api/ai-profiles/:id/test` | admin | Testa provedor/modelo |
| GET | `/api/skills` | admin | Lista skills |
| POST | `/api/skills` | admin | Cria skill |
| GET | `/api/skills/:id` | admin | Detalhe |
| PUT | `/api/skills/:id` | admin | Atualiza |
| DELETE | `/api/skills/:id` | admin | Remove |
| GET | `/api/users` | admin | Lista usuários |
| POST | `/api/users` | admin | Cria usuário |
| PATCH | `/api/users/:id` | admin | Edita papel/estado |
| POST | `/api/users/:id/reset-password` | admin | Redefine senha |
| GET | `/api/webhooks` | admin | Lista webhooks |
| POST | `/api/webhooks` | admin | Cria |
| PATCH | `/api/webhooks/:id` | admin | Atualiza |
| DELETE | `/api/webhooks/:id` | admin | Remove |
| POST | `/api/webhooks/:id/test` | admin | Envia entrega de teste |
| GET | `/api/webhooks/:id/deliveries` | admin | Histórico |
| GET | `/api/settings/system` | admin | Configurações gerais |
| PUT | `/api/settings/system` | admin | Atualiza |
| GET | `/api/audit` | admin | Log de auditoria |
| GET | `/healthz` | público | Processo e banco |
| GET | `/readyz` | público | Poller e worker prontos |

## 10. Pipeline de review

### 10.1 Polling

- Busca: `is:pr is:open review-requested:@me`, ordenada por atualização, `per_page=100`, paginando até o limite da API.
- Repositórios arquivados são ignorados com evento `poll.skipped`.
- PRs cujo autor é a própria conta do bot são ignoradas por padrão (configurável).
- Rascunhos são revisados por padrão (configurável para ignorar).
- Para cada resultado, verifica deduplicação e, se novo, cria job `queued` e faz upsert do repositório.
- Pausar a fila interrompe o polling e novos claims; o job em execução continua até concluir ou ser cancelado. O estado de pausa persiste entre reinícios.
- Falhas de polling são registradas em `events`; erros de autenticação consecutivos pausam o poller.
- O intervalo é configurável (mínimo 30 s) e reiniciado sem necessidade de restart.

### 10.2 Montagem de contexto

- Busca metadados da PR: título, descrição, autor, refs, SHAs, estado, draft, contagens e commits.
- Lista arquivos alterados com patches, paginando; patches ausentes em diffs grandes são tratados como indisponíveis.
- Em PRs de fork, arquivos e árvore são lidos do repositório head; o review é publicado no repositório base.
- Teto padrão: 300 arquivos ou 1 MB de diff. Ao exceder, prioriza código-fonte sobre testes/docs e registra truncamento no prompt e no evento do job.
- Resume reviews e comentários existentes para evitar repetição.
- O conteúdo da PR, código e comentários é tratado como dado não confiável (proteção contra prompt injection).

### 10.3 Ferramentas

| Ferramenta | Função | Limites |
|---|---|---|
| `get_pr_files` | Arquivos alterados e patches | Paginação; patches truncados |
| `read_file` | Conteúdo no SHA da PR, com faixa de linhas | 200 KB por chamada |
| `list_directory` | Lista diretório no SHA | 200 entradas |
| `list_tree` | Árvore do repositório no SHA | 5.000 entradas |
| `search_code` | Busca de código no repositório | 30 resultados; máx. 5 chamadas por job; opera no branch padrão |
| `get_commits` | Commits da PR | 100 commits |
| `get_existing_comments` | Reviews e comentários existentes | 100 itens |
| `add_finding` | Valida e persiste achado inline | Máx. 25 por job |
| `add_general_finding` | Achado sem linha no diff | Máx. 10 por job |
| `submit_review` | Encerra com resumo | Obrigatória para sucesso |

As ferramentas de leitura consomem o orçamento de chamadas ao GitHub (padrão 80 por job, configurável por perfil). A busca de código respeita o limite de 10 requisições/minuto da API. Resultados são truncados com aviso explícito ao modelo.

`add_finding` retorna erro ao modelo quando o path não pertence à PR ou a linha é sintaticamente inválida. Linha fora do diff é aceita com status `outside_diff` e um aviso de que o achado será publicado no corpo do review.

### 10.4 Loop agêntico

- Prompt de sistema: revisor sênior, foco em lógica, segurança, performance, arquitetura e testes; taxonomia `[CRÍTICO]`, `[MÉDIO]`, `[SUGESTÃO]`, `[PONTO FORTE]`; Markdown obrigatório; sem estilo trivial; toda crítica com sugestão concreta; não inventar linhas.
- Pré-prompt do perfil e skills selecionadas são anexados na ordem definida.
- Conteúdo da PR é delimitado como não confiável; o modelo é instruído a nunca seguir instruções embutidas em código, descrição ou comentários.
- Limites padrão: 20 turnos, 200.000 tokens acumulados, 10 minutos, 25 achados, 80 chamadas ao GitHub; timeout de 120 s por chamada ao provedor. Todos são configuráveis por perfil.
- Cada resposta atualiza o consumo. Erros de ferramenta são devolvidos ao modelo para autocorreção.
- Ao atingir um limite, o sistema força uma chamada final sem ferramentas solicitando `submit_review`. Se ainda não houver resumo, gera um resumo determinístico ("Review parcial: limites atingidos; N achados") e publica os achados coletados. O job fica `partial`.
- Sem achados: publica resumo informando que não foram encontrados problemas relevantes.

### 10.5 Validação

- Parseia hunks para construir o conjunto de linhas válidas do lado `RIGHT` (linhas adicionadas e de contexto dentro do hunk).
- `path` deve constar na lista de arquivos alterados.
- Comentário de linha única usa `line`; múltiplas linhas usam `start_line`, `line`, `side=RIGHT` e `start_side=RIGHT`.
- Achado fora do diff é convertido em seção do corpo com `arquivo:linha` e status `fallback`.
- Duplicatas por `(path, linha, severidade, título normalizado)` são descartadas.
- Achados que contenham padrões de segredos (tokens GitHub, chaves AWS, blocos PEM, chaves privadas) são redigidos e sinalizados.

### 10.6 Publicação

- Uma chamada a `POST /repos/{owner}/{repo}/pulls/{n}/reviews` com `commit_id=head_sha`, `event=COMMENT`, corpo-resumo e lista de comentários válidos.
- O corpo começa com o marcador `<!-- pr-reviewer:job:{jobId} -->`.
- Antes de publicar, o sistema lista reviews do commit e procura o marcador; se existir, considera publicado.
- Se a API rejeitar posições (422), republica sem comentários inline e move os achados para o corpo, marcando `fallback`.
- Se a publicação falhar por erro transitório, o job fica `failed` com os achados preservados; o retry manual republica.
- O bot nunca envia `APPROVE` ou `REQUEST_CHANGES`.

### 10.7 Falhas e retry

| Classe | Exemplos | Tratamento |
|---|---|---|
| Transitória | 429, 5xx, timeout, rede | Backoff 30 s/2 min/8 min; respeita `Retry-After`; até 3 tentativas |
| Permanente | 401, 403 de escopo, 404 de repo, configuração inválida | Falha imediata; não repete |
| Conteúdo | Recusa do provedor, saída inválida após correções | Uma nova tentativa de fechamento; depois `partial` ou `failed` |
| Autenticação repetida | 3 falhas consecutivas no poller | Pausa o poller e dispara `poller.paused` |

### 10.8 Máquina de estados

```
queued --claim--> running --ok--> succeeded
                     |  \--limites--> partial
                     |  \--erro-----> failed --retry--> queued
                     |  \--cancel----> cancelled
                     \--shutdown/órfão--> queued
```

## 11. Painel

Tema escuro (fundo `#0B1220`, superfícies `#0F172A`, bordas `#1E293B`), conforme os mockups em `design/review-bot-mockups.figcraft`. Referência visual obrigatória para as telas abaixo.

- **Setup:** token, usuário root, senha e confirmação. Mostra erro claro para token inválido e bloqueia após concluído.
- **Onboarding:** checklist com conexão GitHub, perfil de IA ativo e polling habilitado.
- **Dashboard:** cards de fila, execução atual, reviews nas últimas 24 h/7 dias, falhas e tokens; fila ao vivo e reviews recentes.
- **Reviews:** filtros por repositório, status, severidade e período; detalhe com link da PR, status, perfil usado, consumo, duração, timeline, achados por severidade e arquivo, transcrição e ações.
- **Detalhe da review:** exibe o **corpo do review** (campo `body` do payload publicado, renderizado a partir de Markdown) no topo; cada achado mostra o **trecho do diff com números de linha** e a linha-alvo destacada, o corpo do achado com **Markdown renderizado** (negrito, listas, código inline) e o bloco de sugestão em mono; a coluna lateral traz execução e timeline. O Markdown é renderizado com sanitização (sem HTML bruto) e o código inline em fonte mono com fundo destacado.
- **Fila:** posição, pausa/retomada, cancelamento, enfileiramento manual por URL ou `owner/repo#número`, retry e nova execução (forçar) com confirmação.
- **Definições:** abas GitHub, IA, skills, usuários, webhooks, sistema e auditoria.
- **Feedback:** SSE para atualizações sem recarregar; toasts para ações; confirmação para ações destrutivas; estados vazios e erros explicativos.

## 12. Segurança

- **Senhas:** Argon2id; mínimo de 12 caracteres; username normalizado para minúsculas.
- **Sessões:** token aleatório de 32 bytes; hash SHA-256 no banco; cookie `httpOnly`, `SameSite=Lax`, `Secure` quando `PUBLIC_URL` for HTTPS; rotação no login; invalidação em troca de senha; 12 h de inatividade e 7 dias absolutos.
- **CSRF:** verificação de `Origin`/`Referer` em métodos mutáveis; `SameSite=Lax`.
- **Rate limit:** login 5/min por IP+usuário; setup 5/min; API autenticada 120/min por sessão.
- **RBAC:** verificado em cada rota; `viewer` nunca muta; `operator` não altera credenciais; root é imutável; último admin protegido.
- **Segredos:** AES-256-GCM com chave de 32 bytes em `APP_ENCRYPTION_KEY`; formato versionado; nunca retornados pela API; logs com redaction. Perda da chave exige recadastrar segredos.
- **Setup:** token de 32 bytes, hash no banco, exibido uma única vez; comparação em tempo constante; rota encerrada após o root.
- **SSRF:** validação de URLs de provedores e webhooks; bloqueio de IPs privados, loopback, link-local e metadados por padrão; flag `ALLOW_PRIVATE_URLS` para uso interno; redirecionamentos revalidados.
- **Headers/CSP:** `default-src 'self'`, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`; HSTS documentado no proxy.
- **Prompt injection:** conteúdo do repositório é não confiável; ferramentas são read-only; o modelo não pode executar ações; saída é validada e redigida.
- **Privacidade:** aviso de envio de código ao provedor; retenção configurável; transcrições acessíveis apenas a usuários autenticados.
- **Auditoria:** ações administrativas e de fila registradas.

## 13. Operação

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `APP_ENCRYPTION_KEY` | Sim | 32 bytes em base64 para AES-256-GCM |
| `SETUP_TOKEN` | Não | Substitui o token de setup gerado, útil para recuperar o acesso antes do primeiro root |
| `PORT` | Não (3000) | Porta HTTP |
| `DATA_DIR` | Não (`/data`) | Diretório do SQLite |
| `PUBLIC_URL` | Sim em produção | URL pública para Origin e cookies |
| `TRUST_PROXY` | Não (`false`) | Confia em `X-Forwarded-*` do proxy |
| `ALLOW_PRIVATE_URLS` | Não (`false`) | Permite provedores/webhooks em rede privada |
| `LOG_LEVEL` | Não (`info`) | Nível de log |
| `TZ` | Não (`UTC`) | Fuso para exibição |

### Docker Compose

- Serviço único `app`, imagem multi-stage, usuário non-root, porta 3000, volume `data:/data`, `restart: unless-stopped`.
- Healthcheck em `/healthz`.
- Sem Caddy/TLS embutido; o operador fornece proxy reverso.
- Build multi-arquitetura para `linux/amd64` e `linux/arm64`.

### Instalação

1. Criar `.env` com `APP_ENCRYPTION_KEY` gerada por `openssl rand -base64 32` e `PUBLIC_URL`.
2. `docker compose up -d`.
3. Ler o token de setup em `docker compose logs app`.
4. Configurar o proxy TLS.
5. Acessar o painel, concluir o setup e o onboarding.

Se o token for perdido antes do setup, definir `SETUP_TOKEN` no `.env` e reiniciar; como alternativa, recriar o volume (perde apenas dados ainda não configurados).

### Backup e recuperação

- Script `scripts/backup.mjs` usa a API de backup do SQLite e grava em `data/backups/` com timestamp; o arquivo pode ser copiado para fora do volume.
- Antes de upgrades, executar backup.
- Migrations rodam no boot; falha de migration impede o start e registra erro.

### Reset de senha do root

- `docker compose exec app node scripts/reset-password.mjs <username>` solicita nova senha de forma interativa.
- A ação é registrada em auditoria.

## 14. Observabilidade e retenção

- Logs estruturados em JSON (Pino) com request id, job id e redaction de `authorization`, tokens e chaves.
- Eventos de job persistidos e exibidos na timeline; SSE publica atualizações em tempo real com heartbeat de 25 s. Tipos: `queue.updated`, `job.created`, `job.started`, `job.progress`, `job.finished`, `poll.updated`.
- Métricas do dashboard calculadas do banco: profundidade da fila, duração, tokens de entrada/saída, taxa de falha.
- Limpeza diária: `agent_messages`, `events`, `webhook_deliveries` e `github_cache` além da retenção (90 dias padrão); auditoria 180 dias.
- Nenhuma integração com Prometheus/Grafana nesta versão.

## 15. Testes

- **Unitários:** parser de hunks e linhas válidas, deduplicação, máquina de estados, backoff, montagem de prompt, schemas, RBAC, criptografia, validação SSRF, redação de segredos, adaptadores com fixtures.
- **Integração:** SQLite em memória, servidor GitHub falso, provedores falsos; fluxo completo polling→fila→agente→publicação; fallback 422; idempotência por marcador; recuperação de órfão; nova execução (`run_seq`) preservando histórico; setup/login/sessão; rate limit.
- **E2E (Playwright):** setup, login, criação de perfil, dashboard com SSE, detalhe de review, permissões por papel.
- **CI:** `typecheck`, `lint`, `test`, `build`. Cobertura obrigatória dos caminhos críticos, sem meta percentual global.
- **Aceite manual:** repositório de teste, PAT real e provedor de baixo custo.

## 16. Critérios de aceite

- **AC-01:** em instalação limpa, o setup exige o token do log; token errado é rejeitado; root é criado; novas tentativas de setup passam a ser rejeitadas (409).
- **AC-02:** é possível salvar e testar o PAT; o login da conta é exibido; o token nunca retorna pela API.
- **AC-03:** um review request gera job em até dois ciclos de polling e publica um review com resumo e comentários inline válidos.
- **AC-04:** um novo commit com novo request gera novo job; o SHA anterior não é republicado. Re-polling não duplica.
- **AC-05:** falha 500 do provedor gera retries; ao esgotar, o job fica `failed`, o webhook dispara e o retry manual publica sem duplicatas.
- **AC-06:** achado em linha fora do diff é movido para o corpo e o review é publicado.
- **AC-07:** três falhas de autenticação consecutivas pausam o poller e disparam `poller.paused`.
- **AC-08:** `viewer` não muta nada; `operator` reprocessa jobs mas não altera credenciais; `admin` gerencia tudo; o último admin não pode ser removido.
- **AC-09:** segredos aparecem cifrados no banco e redigidos nos logs.
- **AC-10:** a rotina de retenção remove transcrições e eventos antigos e preserva reviews.
- **AC-11:** cancelar um job em execução não publica review e o estado fica `cancelled`.
- **AC-12:** PR sem achados recebe um review-resumo informando que não há problemas relevantes.
- **AC-13:** forçar uma nova execução de um SHA já revisado cria um job com `run_seq` incrementado, publica um novo review e mantém o histórico anterior intacto.

## 17. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Rate limit do GitHub | Atraso ou falha de análise | Cache ETag, paginação, 1 job por vez, orçamento de chamadas |
| Diferenças de tool calling entre provedores | Falha de análise | Adaptadores normalizados, schema validado, `tool_choice` forçado, testes de contrato |
| Linhas inválidas no review | 422 e perda de comentários | Validação por hunk e fallback para o corpo |
| PRs muito grandes | Contexto truncado | Priorização, aviso explícito e teto configurável |
| Prompt injection no código/PR | Comportamento indevido ou vazamento | Conteúdo não confiável, ferramentas read-only, validação e redação de saída |
| Custo elevado | Consumo inesperado | Tetos por job, 1 job por vez, consumo visível |
| PAT expirado/revogado | Poller inoperante | Pausa automática e webhook |
| Alucinação de achados | Comentários incorretos | Exigência de evidência, validação de path/linha, revisão humana opcional via histórico |
| SQLite com concorrência > 1 | Contenção de escrita | WAL, busy timeout, padrão 1 e limite 3 |
| Perda da chave de criptografia | Segredos inutilizáveis | Documentação e backup seguro da chave |
| DNS rebinding em webhooks (TOCTOU) | SSRF residual em URL admin-configurada | Revalidação da URL a cada hop; pinning do endereço validado fica para v2 (risco aceito na v1) |

## 18. Fora de escopo (v1)

- Webhooks de entrada do GitHub; gatilho por menção ou comando.
- Clone local, git bash, execução de testes ou qualquer shell.
- Aprovar PRs ou solicitar mudanças.
- Autenticação em dois fatores (2FA) no painel.
- Múltiplas contas GitHub na mesma instalação.
- Múltiplas réplicas/workers distribuídos.
- Notificações por e-mail, app mobile ou i18n da interface.
- Cálculo de custo monetário e orçamento mensal.
- Integração com Prometheus/Grafana.
- Revisão de PRs de repositórios não acessíveis pela conta.
- Edição manual do corpo do review antes da publicação (a publicação é automática).

## 19. Glossário

- **Review request:** solicitação de review feita a um usuário/equipe em uma PR.
- **Head SHA:** commit mais recente da branch da PR no momento da análise.
- **Hunk:** bloco de linhas alteradas em um patch unificado.
- **Achado (finding):** problema ou destaque produzido pelo agente, com severidade e sugestão.
- **Review inline:** comentário anexado a uma linha específica do diff.
- **Perfil de IA:** conjunto de provedor, modelo, parâmetros, prompt e skills.
- **Job:** uma execução de revisão de uma PR em um SHA; execuções repetidas do mesmo SHA são distinguidas por `run_seq`.
- **PAT:** Personal Access Token do GitHub.
