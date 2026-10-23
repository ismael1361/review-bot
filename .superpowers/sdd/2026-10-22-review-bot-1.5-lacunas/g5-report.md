# G5 — Relatório: SSE no SPA, auditoria no painel e verificação final

**Status:** DONE

## Implementado

- **Hook `useEvents`** (`src/web/hooks/useEvents.ts`): assinatura `useEvents(queryKeys: QueryKey[]): void`. Se `typeof EventSource === 'undefined'`, retorna sem criar nada. Caso contrário, cria `new EventSource('/api/events')`, invalida cada chave via `queryClient.invalidateQueries({ queryKey })` no `onopen` (conexão inicial e reconexões automáticas do navegador) e fecha a conexão no cleanup (`source.close()`). Dependências do efeito: `queryClient` e `queryKeys`.
- **Dashboard**: usa `useEvents(DASHBOARD_QUERIES)` com constante de módulo `DASHBOARD_QUERIES: QueryKey[] = [['dashboard']]`.
- **Fila**: usa `useEvents(QUEUE_QUERIES)` com `QUEUE_QUERIES: QueryKey[] = [['queue'], ['jobs']]`.
- **Reviews**: usa `useEvents(REVIEWS_QUERIES)` com `REVIEWS_QUERIES: QueryKey[] = [['reviews']]`.
- **Aba Auditoria** (`src/web/pages/settings/Audit.tsx`): `useState(1)` para página, `useQuery({ queryKey: ['audit', page], queryFn: ... '/api/audit?page=${page}&limit=20' })`. Tabela com data (`createdAt` em `toLocaleString('pt-BR')`), usuário (`userId` ou `—`), ação, alvo (`targetType/targetId`, com fallback) e IP (`ip` ou `—`). Estados de carregamento, erro e vazio ("Nenhuma entrada de auditoria."). Paginação com `Anterior` desabilitado na primeira página, `Próxima` desabilitado quando `page * 20 >= total` (ambos também desabilitados durante `isFetching`) e indicador "Página X de Y". `dataJson` não é exibido.
- **Rota/aba**: `Auditoria` adicionada ao final das abas admin-only com `to: 'auditoria'`, e `<Route path="auditoria" element={<Audit />} />` em `settings/index.tsx`.

## Arquivos alterados

- `src/web/hooks/useEvents.ts` (novo)
- `src/web/pages/Dashboard.tsx`
- `src/web/pages/Queue.tsx`
- `src/web/pages/Reviews.tsx`
- `src/web/pages/settings/Audit.tsx` (novo)
- `src/web/pages/settings/index.tsx`
- `tests/web/use-events.test.tsx` (novo)
- `tests/web/audit.test.tsx` (novo)

Nenhum arquivo de servidor, docs, planos ou artefatos do `.superpowers` (além deste relatório) foi alterado. Sem commits, conforme instrução.

## Testes

`tests/web/use-events.test.tsx`:
- Classe falsa `FakeEventSource` registra instâncias/URL, guarda `onopen` e marca `close()`.
- Verifica criação de `/api/events`, dispara `onopen` e asserta `invalidateQueries({ queryKey: ['dashboard'] })`.
- Desmonta e verifica `close()`.
- Caso adicional: sem `EventSource` disponível, nenhuma conexão é criada e nenhuma invalidação ocorre.

`tests/web/audit.test.tsx`:
- Mock de fetch para `/api/audit?page=1&limit=20` e `/api/audit?page=2&limit=20` com `total: 21`.
- Asserta entradas da página 1 (ação, usuário, alvo, IP e data formatada), "Página 1 de 2" e `Anterior` desabilitado.
- Clica `Próxima`, asserta a chamada da página 2, o novo conteúdo, "Página 2 de 2", `Anterior` habilitado e `Próxima` desabilitado.

## Verificação

- Focados: `bunx vitest run tests/web/use-events.test.tsx tests/web/audit.test.tsx tests/web/app.test.tsx` → 3 arquivos, 4 testes, todos passando (inclui a regressão de Dashboard com `EventSource` indefinido).
- `bun run typecheck` → limpo.
- `bun run lint` → limpo.
- `bun run test` → 36 arquivos, 133 testes, todos passando.
- `bun run build` → `vite build` e `tsup` concluídos sem erros.

## Observações

- O ledger/`progress.md` não foi atualizado por mim: o enunciado da tarefa reserva os artefatos `.superpowers` ao controlador; apenas este relatório foi escrito, como solicitado.
- A reconexão é delegada ao `EventSource` nativo; nenhum retry manual foi adicionado, e nenhum listener de eventos individuais foi criado (apenas `onopen`), conforme o brief.

## Revisão da tarefa

Revisor independente: **Spec compliant**, **Task quality: Approved**. Nenhum achado Critical ou Important. Três achados Minor registrados no ledger como deferred (rodapé transitório da auditoria, chaves de query duplicadas e lacunas de cobertura).

## Verificação do controlador

- `bun run typecheck`: ok.
- `bun run lint`: ok.
- `bun run test`: 36 arquivos, 133 testes verdes.
- `bun run build`: ok (web e server).
