# G2 — Saúde real e SSE endurecido

## Status

Concluído. Nenhum commit criado.

## Mudanças

### Saúde

- `src/api/routes/health.ts`: `registerHealthRoutes` agora recebe `deps`; `/healthz` executa `SELECT 1` via `deps.db.run(sql\`SELECT 1\`)` e responde `{ status: 'ok', db: true }` ou 503 `{ status: 'error', db: false }`.
- `/readyz` executa o mesmo check, lê `isQueuePaused(deps.db)` e retorna `{ status: 'ok', paused, uptimeSec }`; em falha de banco responde 503 `{ status: 'error' }`.
- `uptimeSec` conta a partir do registro das rotas de saúde no app.
- `src/api/app.ts`: `registerHealthRoutes(app, deps)`.

### SSE

- `src/api/routes/events.ts`: contador de conexões ativas no closure de `registerEventRoutes`, limite de 50; a 51ª conexão recebe `AppError('Limite de conexões SSE', 'too_many_streams', 503)`.
- Sessão revalidada com `resolveSession` antes de cada evento publicado e em cada heartbeat de 25s.
- Sessão inválida encerra a resposta bruta, remove o listener, limpa o heartbeat e decrementa o contador.
- Flag `closed` torna a limpeza idempotente entre `request.raw` close, revogação de sessão e encerramento explícito.
- Marcador `: connected`, heartbeat `: ping` e cleanup no close preservados.

## Testes

Atualizados/adicionados:

- `tests/integration/health.test.ts`: `/healthz` com `{ status: 'ok', db: true }`; 503 com banco falhando; `/readyz` com `status`, `paused` booleano e `uptimeSec` numérico; 503 com banco falhando.
- `tests/integration/events.test.ts`: stream real lê `: connected`, sessão é destruída, evento é publicado e o stream termina sem entregar o evento (Promise.race com timeout de 1s e cleanup em `finally`); novo teste abre 50 streams e verifica 503 `too_many_streams` na conexão seguinte.
- Os dois testes SSE existentes continuam passando.

Resultados:

- Focados: 2 arquivos, 9 testes verdes.
- `yarn typecheck`: ok.
- `yarn lint`: ok.
- `yarn test`: 27 arquivos, 111 testes verdes (106 anteriores + 5 novos).
- `yarn build`: ok (web e server).

## Preocupações

- A revalidação de sessão grava no SQLite em cada evento e heartbeat (`lastSeenAt`/`idleExpiresAt`); com volume alto de eventos isso adiciona custo síncrono por conexão.
- O contador de 50 conexões é por instância do app/processo, alinhado à premissa de instância única; não é compartilhado entre réplicas.
- O teste de limite abre 50 conexões SSE reais; é determinístico localmente e roda em menos de 1s, mas consome mais sockets que os demais testes.
- O caminho de heartbeat inválido não tem teste dedicado (exigiria esperar 25s ou fake timers); a mesma função `write` é exercitada pelo teste de revogação por evento.
- A checagem de limite ocorre depois de autenticação/rate limit, então conexões rejeitadas ainda custam a resolução de sessão.
- `/readyz` em falha retorna apenas `{ status: 'error' }`, conforme o plano do Plano 3, sem `paused`/`uptimeSec`.

## Correção pós-revisão (Important)

### Important 1 — I/O de banco nos callbacks SSE

- `src/api/routes/events.ts`: o handler de eventos publicados e o intervalo de heartbeat agora envolvem `write()` em `try/catch`.
- Em qualquer erro, `failStream(error)` registra `warn` via `deps.logger`, chama `cleanup()` e encerra `reply.raw`; uma exceção de SQLite não escapa mais pelo `EventBus.publish` nem vira exceção não capturada no intervalo.
- `cleanup()` continua idempotente pelo flag `closed`, incluindo decremento único do contador.

### Important 2 — Cleanup ligado a erros da resposta

- `src/api/routes/events.ts`: além de `request.raw.on('close', cleanup)`, foram adicionados `reply.raw.on('error', cleanup)` e `reply.raw.on('close', cleanup)`.
- Todo o setup pós-`activeConnections += 1` (hijack, headers, marcador, subscribe e intervalo) está em `try/catch`; uma falha de setup chama `failStream`, que limpa listeners/contador e encerra a resposta.

### Verificação da correção

- Focados: `tests/integration/events.test.ts` e `tests/integration/health.test.ts`, 2 arquivos, 9 testes verdes.
- `yarn typecheck`: ok.
- `yarn lint`: ok.
- `yarn test`: 27 arquivos, 111 testes verdes.
- `yarn build`: ok (web e server).
- Não foi adicionado teste específico para falha de banco nos callbacks SSE: não há indução limpa sem mock frágil de `resolveSession`/Drizzle; o comportamento defensivo foi coberto por typecheck/lint e pela suíte existente.
