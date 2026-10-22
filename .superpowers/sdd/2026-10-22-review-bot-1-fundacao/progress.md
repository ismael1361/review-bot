# SDD ledger — plan: D:\projetos\review-bot\docs\superpowers\plans\2026-10-22-review-bot-1-fundacao.md

Constraint: o projeto NÃO usa git (instrução do usuário). Não há worktree, commits, BASE/HEAD ou review-package por diff. Cada tarefa produz arquivos no diretório D:\projetos\review-bot; a revisão lê os arquivos e o relatório do implementador. O ledger é a única memória de progresso.

Spec: D:\projetos\review-bot\docs\superpowers\specs\2026-10-22-pr-review-agent-design.md

## Varredura prévia de conflitos

| Par de tarefas / área | Produz vs. consome | Resultado |
|---|---|---|
| T1 → T5 → T6 (buildApp) | sync sem deps → sync com deps → async | ok; T6 atualiza helper e testes |
| T1 → T15 (server.ts) | package.json referencia src/server.ts antes de existir | ok; nenhum build completo antes da T15 |
| T3 → T6/T7/T9-T13 (schema) | tabelas criadas todas na T3 | ok |
| T5 → T6 (setup auto-login) | T5 cria rota; T6 adiciona sessão/cookie | ok, atualização explícita |
| T9 → T10/T12 (testConnection) | move para client.ts; credentials importa | ok, instrução explícita |
| T13 (AppDeps.bus) → T15 (server) | bus obrigatório | ok |
| T14 (UI) → T5-T13 (rotas) | todas as rotas existem antes da UI | ok |
| T14 (build:web) vs T1 (build completo) | server.ts ausente até T15 | corrigido: T14 roda build:web |
| T12 webhook test | URL externa exigia DNS | corrigido: IP público literal no teste |
| T14 tema claro vs decisão escura | conflito com o spec atualizado | corrigido: tokens escuros + nota no T14 |

Nenhum defeito mandatado pelo plano restante.

## Progresso

Task 1: complete (no commits — no git; review clean, approved; 1/1 test, typecheck+lint clean)
Task 1: minor (deferred): try/finally no app.close() do teste; /readyz sem teste; sem packageManager pin; warnings de deprecação em jest-dom/eslint; coverage/ fora do eslint ignore
Ruling: migrar de pnpm para Yarn 4.5.1 (Corepack, nodeLinker node-modules) por instrução do usuário — custo se errado: scripts/lockfile/Docker divergem e precisam de retrabalho.
Ruling: Task 2 foi interrompida no meio; apagar os arquivos criados pelo subagente abortado e refazer com TDD/relatório — custo se errado: retrabalho de 3 arquivos pequenos.
Task 2: complete (no commits; review found 1 Important de redaction; fix round 1 addressed; 6/6 tests, typecheck+lint clean)
Task 2: minor (deferred): PUBLIC_URL aceita esquemas não-http; testes de defaults incompletos; APP_ENCRYPTION_KEY só min(1) (T4 valida 32 bytes)
Task 3: complete (no commits; review clean, approved; 8/8 tests, typecheck+lint clean; migration 0000 gerada)
Task 3: minor (deferred): caminho relativo 'drizzle' no helper; enums/booleans só em TS; cobertura de cascatas adiada
Task 4: complete (no commits; review clean, approved; 15/15 tests, typecheck+lint clean)
Task 4: minor (deferred): payload vazio não round-trip; split aceita segmento extra; constantTimeEqualHex não valida hex; Argon2 não explicita Argon2id; erros de backend viram 401
Task 5: complete (no commits; review found 1 Important de corrida no setup; fix round 1 addressed; 20/20 tests)
Task 5: minor (deferred): erro Fastify 4xx vira 500; AC-01 alinhado no spec para 409
Task 6: complete (no commits; 2 Important: cookie fixo e rate-limit por username; fix round 1 addressed; 33/33 tests)
Task 6: minor (deferred): Referer não checado; 4xx genérico vira 500; purge de sessões sem agendamento; enumeração por timing; sem rate limit na troca de senha; slide grava a cada request
Task 7: complete (no commits; review clean, approved; 38/38 tests)
Task 7: minor (deferred): demoting de admin desativado retorna 409; mutação e auditoria em writes separados; reset sem data na auditoria; corrida de username duplicado; PATCH {} aceito; cobertura de reset/revogação/auditoria
Ruling: ratificada a interpretação "último admin além do root" (root imutável e excluído da contagem) — custo se errado: impede rebaixar o único admin não-root, corrigível removendo `isRoot = false`.
Task 8: complete (no commits; 1 Critical de SSRF IPv6 mapeado; fix round 1 addressed; 49/49 tests)
Task 8: minor (deferred): NAT64 local-use 64:ff9b:1::/48 não bloqueado; TOCTOU/redirect pinning ficam para a integração de fetch
Task 9: complete (no commits; review clean, approved; 52/52 tests)
Task 9: minor (deferred): GET de credenciais sem teste; mapeamento de erros GitHub e timeout de 30s foram levados ao Plano 2
Task 10: complete (no commits; review clean, approved; 59/59 tests)
Task 10: minor (deferred): baseUrl não-http no /test retorna 500; vínculos de skill fora da transação e duplicatas; falhas de transporte não viram AppError; drift de interface; cobertura de 403/auditoria/limites; cap de prompt em UTF-16; N+1 em listProfiles
Task 11: complete (no commits; review clean, approved; 63/63 tests)
Task 11: minor (deferred): duplicata não atômica (SQLite síncrono); cobertura de 404/403/limites; teste de ordering não lê position; auditoria fora da transação
Task 12: complete (no commits; 1 Critical de SSRF por redirect; fix round 1 addressed; 69/69 tests)
Task 12: minor (deferred): corpos de redirect não drenados; pior caso por tentativa ~40s; entregas de webhook inexistente retornam 200 []; body bufferizado; um webhook ruim aborta os demais
Ruling: DNS rebinding (TOCTOU) em webhooks admin-configurados aceito como risco residual na v1; redirects fechados por revalidação hop a hop; pinning de endereço fica para v2 (registrado no spec).
Task 13: complete (no commits; 2 Important: SSE no shutdown e auditoria do toggle; fix round 1 addressed; 76/76 tests)
Task 13: minor (deferred): bus sem isolamento de listener; paginação sem tie-breaker; reviews sem filtros; PUT de sistema substitui defaults; SSE sem reautenticação/limite; testes rasos de paginação/RBAC
Task 14: complete (no commits; 1 Critical do content-type em requests sem body + 2 Important; fix round 1 addressed; 84/84 tests)
Task 14: minor (deferred): loading skeletons; api headers não suportam Headers/array; erros silenciosos em ações de fila/skills; SPA fallback para /api e POSTs; secrets/webhook coverage
Task 15: complete (no commits; review clean, approved; build/typecheck/lint + smoke ok; imagem Docker não construída por ausência de daemon)
Ruling: Vitest estabilizado com testTimeout/hookTimeout 20s e fileParallelism false (Windows/Argon2) — custo: suíte completa leva 65-130s.
Task 16: verificação — suíte 84/84 duas vezes, typecheck/lint/build limpos.
Final review: 2 Critical (SSRF no teste de perfil; vínculos de skill não atômicos), 4xx→500 e FK de jobs.profile_id; todos corrigidos e re-revisados. Migração 0001 removida. 91/91 testes, typecheck/lint/build limpos.
Ruling: exclusão de perfil limpa jobs.profileId em transação no app e a migração 0001 foi removida para evitar rebuild de tabela com perda de dados no SQLite — custo: jobs históricos perdem o vínculo com o perfil, mas mantêm profileSnapshotJson.
Ruling: adiados para Planos 2/3 (não bloqueiam o poller): GET/UI de auditoria, CRUD completo de perfis/usuários/skills/webhooks no painel, EventSource no SPA + reautenticação/limite de SSE, /healthz real, rate limit autenticado e na troca de senha, timing de login, validação de escopos do PAT, atomicidade de auditoria e corrida de username, build Docker não verificado — custo: painel administrativo incompleto e robustez menor até lá.

