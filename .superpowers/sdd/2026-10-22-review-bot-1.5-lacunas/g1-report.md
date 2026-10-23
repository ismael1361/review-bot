# G1 — Auditoria consultável e endurecimento de auth/API

## Status

Concluído. Nenhum commit criado.

## Mudanças

### Auditoria

- Novo `src/api/routes/audit.ts`: `GET /api/audit` restrito a admin, query `page` (>=1, padrão 1) e `limit` (1..100, padrão 20), ordenação `created_at` desc, resposta `{ entries, total }`.
- Registrado em `src/api/app.ts` via `registerAuditRoutes`.

### Rate limits

- Novo `src/auth/rate-limit.ts` com `createRateLimiter` e clock injetável.
- `src/api/plugins/security.ts`: limiter de sessão de 120 req/min por token (`hashToken` do cookie `prr_session`), aplicado a `/api/*` quando há cookie, exceto `/api/auth/login` e `/api/setup`; erro `AppError('Muitas requisições', 'rate_limited', 429)`.
- `src/api/routes/auth.ts`: `POST /api/auth/password` com `config.rateLimit` de 5/min, `hook: 'preHandler'`, chave `IP + userId` (fallback para hash do cookie).

### Configuração e CSRF

- `src/config.ts`: `PUBLIC_URL` aceita apenas `http:`/`https:` via `z.string().url().refine(...)`.
- `src/api/plugins/security.ts`: quando não há `Origin`, usa `new URL(referer).origin`; Referer inválido ou cross-site retorna 403; ambos ausentes continuam permitidos.

### Login

- `src/api/routes/auth.ts`: constante `DUMMY_PASSWORD_HASH` (Argon2id, mesmos parâmetros de `hashPassword`) verificada para usuário inexistente ou desativado antes do 401 genérico. Usuário válido executa apenas uma verificação.

### Usuários

- `PATCH /api/users/:id` exige ao menos `role` ou `disabled` (Zod refine → 400).
- Criação captura `SQLITE_CONSTRAINT*` e retorna `AppError 409 username_taken`.
- Create/update/reset-password executam mutação + auditoria em `db.transaction`; hash de senha calculado antes da transação; revogação de sessões do reset dentro da transação.

### Sessões

- `src/server.ts`: `purgeExpiredSessions` no boot e a cada 24h (`setInterval` com `unref`), com `clearInterval` no shutdown.

## Testes

Novos/atualizados:

- `tests/unit/rate-limit.test.ts` (novo): máximo atingido, chaves independentes e reset da janela com clock fake.
- `tests/integration/audit.test.ts` (novo): viewer 403; admin recebe `{ entries, total }`, paginação e rejeição de `limit=101`.
- `tests/integration/auth.test.ts`: Referer válido permitido, Referer cross-site 403, ausência de Origin/Referer permitida, 6ª troca de senha 429, login de usuário desativado 401.
- `tests/integration/users.test.ts`: `PATCH {}` 400, username duplicado 409.
- `tests/unit/config.test.ts`: aceita http/https e rejeita `ftp://`.

Resultados:

- Focados: 6 arquivos, 34 testes verdes.
- `yarn typecheck`: ok.
- `yarn lint`: ok.
- `yarn test`: 27 arquivos, 103 testes verdes (91 anteriores + 12 novos).
- `yarn build`: ok (web e server).

## Preocupações

- O limiter de sessão é em memória e por processo: não compartilha estado entre réplicas e o `Map` não remove tokens antigos (crescimento proporcional ao número de sessões já vistas no processo).
- Requisições `/api/*` sem cookie não passam pelo limiter de sessão; login e setup mantêm seus limites próprios por rota.
- O limite da troca de senha usa `request.user` porque o hook `preHandler` do `@fastify/rate-limit` é anexado após o `requireAuth` da rota; há fallback para hash do cookie caso a ordem mude.
- `purgeExpiredSessions` remove apenas sessões com expiração absoluta vencida (comportamento existente); sessões apenas idle continuam sendo removidas sob demanda no `resolveSession`.
- A resposta de auditoria expõe `dataJson` como string JSON bruta, consistente com a tabela; o parse fica para o consumidor.

## Correção pós-revisão (Important)

Achado: o `Map` do rate limiter não tinha eviction; qualquer requisição com cookie `prr_session` aleatório criava entrada permanente, com crescimento controlado pelo atacante.

- `src/auth/rate-limit.ts`: `createRateLimiter` agora aceita `maxEntries` (padrão 10.000) e limita o tamanho do mapa. Ao atingir o limite, faz sweep das entradas com `resetAt <= agora`; se ainda estiver cheio, rejeita a nova chave com `false` (não cria entrada). O `now` injetável permanece suportado.
- `src/api/routes/audit.ts`: ordenação secundária `desc(auditLog.id)` para paginação estável quando `created_at` empata.
- `tests/unit/rate-limit.test.ts`: novos casos para limite de entradas (terceira chave rejeitada), sweep de expiradas liberando espaço para novas chaves e reset de chave existente após a janela com o mapa cheio.
- `tests/integration/audit.test.ts`: caso com `created_at` empatado verificando a ordem estável por `id` desc entre páginas.
- Resultado: focados 7 testes verdes; suíte completa 106 testes verdes (27 arquivos); `typecheck`, `lint` e `build` ok.
- Observação remanescente: o limiter continua em memória e por processo (sem compartilhamento entre réplicas), mas agora tem limite superior de memória e expiração das entradas.
