# G5 — SSE no SPA, auditoria no painel e verificação final

**Files:** `src/web/hooks/useEvents.ts`, `src/web/pages/Dashboard.tsx`, `Queue.tsx`, `Reviews.tsx`, `src/web/pages/settings/Audit.tsx`, `src/web/pages/settings/index.tsx`, tests; ledger.

**Requisitos:**

- Hook `useEvents` com `EventSource('/api/events')`, reconexão padrão e `onopen` invalidando queries; usar em Dashboard/Fila/Reviews.
- Aba Auditoria (admin) com lista paginada.
- Verificação: suíte completa (91+), typecheck, lint, build; revisão final do Plano 1.5; atualizar ledger.

## Contexto do repositório

- `GET /api/events` é SSE autenticado (viewer+), envia `event: <tipo>` e `data: <json>`, heartbeat `: ping`; a sessão é revalidada no servidor.
- `GET /api/audit?page=1&limit=20` (admin) → `{ entries, total }`; entries têm `id, userId, action, targetType, targetId, dataJson, ip, createdAt` (epoch ms), ordenadas desc.
- `src/web/pages/settings/index.tsx` já tem abas admin-only e rotas; adicionar a aba/rota de Auditoria.
- `EventSource` não existe no jsdom usado pelos testes; o hook deve verificar `typeof EventSource === 'undefined'` e não fazer nada nesse caso, para não quebrar os testes existentes de App/Dashboard.
- O `EventSource` do navegador já reconecta sozinho; não implementar retry manual.
- Este G5 não exige tratar eventos individuais: o requisito é invalidar as queries no `onopen` (conexão inicial e reconexões). Não adicionar listeners de eventos sem necessidade.

## Contrato do hook

Criar `src/web/hooks/useEvents.ts`:

```ts
import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

export function useEvents(queryKeys: QueryKey[]): void
```

Comportamento:
- Se `typeof EventSource === 'undefined'`, retornar sem criar nada.
- Criar `new EventSource('/api/events')`.
- Em `source.onopen`, invalidar cada `queryKey` via `queryClient.invalidateQueries({ queryKey })`.
- Cleanup: `source.close()`.
- Dependências do efeito: `queryClient` e `queryKeys` estável. Nos componentes, declarar as chaves como constantes fora do componente (`const DASHBOARD_QUERIES: QueryKey[] = [['dashboard']]` etc.) para não recriar o EventSource a cada render.

Uso:
- `Dashboard`: invalidar `['dashboard']`.
- `Queue`: invalidar `['queue']` e `['jobs']`.
- `Reviews`: invalidar `['reviews']`.

## Página de Auditoria

Criar `src/web/pages/settings/Audit.tsx`:
- `useState(1)` para a página; `useQuery` com `queryKey: ['audit', page]` e `queryFn` chamando `/api/audit?page=${page}&limit=20`.
- Exibir tabela/lista com data (`createdAt` formatado em `pt-BR`), usuário (`userId` ou `—`), ação, alvo (`targetType`/`targetId`) e IP.
- Paginação: botão `Anterior` desabilitado na primeira página; `Próxima` desabilitado quando `page * 20 >= total`; mostrar “Página X de Y”.
- Estados de carregamento, erro e vazio (“Nenhuma entrada de auditoria.”).
- Não exibir segredos; `dataJson` pode ser omitido.

Adicionar em `src/web/pages/settings/index.tsx`:
- Aba `Auditoria` (`to: 'auditoria'`) ao final; a tela já é admin-only.
- Rota `<Route path="auditoria" element={<Audit />} />`.

## Testes obrigatórios

- `tests/web/use-events.test.tsx` (jsdom):
  - mockar `globalThis.EventSource` com uma classe falsa que registra a URL, guarda `onopen` e `close()`;
  - renderizar um componente que chama `useEvents([['dashboard']])` dentro de `QueryClientProvider`;
  - verificar `new EventSource('/api/events')`, disparar `onopen` e assertar `invalidateQueries` para `['dashboard']`;
  - desmontar e verificar `close()`.
- `tests/web/audit.test.tsx` (jsdom):
  - mockar fetch para `/api/audit?page=1&limit=20` e `/api/audit?page=2&limit=20`;
  - renderizar `Audit`, assertar entradas e total;
  - clicar `Próxima`, assertar a chamada da página 2 e o novo conteúdo; verificar `Anterior` desabilitado na página 1.
- Não quebrar `tests/web/app.test.tsx` (Dashboard renderiza com `EventSource` indefinido).

## Convenções

- React 19, TanStack Query 5, Tailwind v4, tema escuro, UI PT-BR, sem comentários, TypeScript estrito.
- Componentes `Card`, `Button`, `EmptyState` de `src/web/components/ui.tsx`; `api`/`ApiRequestError` de `src/web/api.ts`.
- Testes com docblock `// @vitest-environment jsdom`, Testing Library e `QueryClientProvider` com `retry: false`.
- Não criar commits (instrução do usuário). Não alterar servidor, planos, docs ou artefatos `.superpowers`.

## Verificação

Rodar os testes focados, depois `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`. Reportar no arquivo de relatório.
