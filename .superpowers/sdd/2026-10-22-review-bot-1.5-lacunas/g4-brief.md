# G4 — Usuários, webhooks e troca de senha no painel

**Files:** `src/web/pages/settings/Users.tsx`, `Webhooks.tsx`, `src/web/pages/settings/index.tsx`, novo `src/web/pages/Password.tsx` (ou seção no shell), `src/web/components/Layout.tsx`, tests.

**Requisitos:**

- Usuários: alterar papel (admin), redefinir senha (modal/inline), desativar/ativar.
- Webhooks: editar URL/eventos/segredo opcional, excluir, listar entregas (últimas 50) e testar com feedback correto de `ok`.
- Troca da própria senha: formulário (senha atual, nova, confirmação) chamando `/api/auth/password`; link no shell.
- Testes: alteração de papel envia PATCH; reset envia POST; edição de webhook envia PATCH; troca de senha valida 12+ e envia.

## Contratos de API já existentes (não alterar o servidor)

- `GET /api/users` → `{ users: [{ id, username, role, isRoot, disabled, createdAt, lastLoginAt }] }`
- `PATCH /api/users/:id` body `{ role?: 'admin'|'operator'|'viewer', disabled?: boolean }` → `{ user }`
- `POST /api/users/:id/reset-password` body `{ password }` (mín. 12) → 204
- `GET /api/webhooks` → `{ webhooks: [{ id, url, events, enabled, createdAt, updatedAt }] }`
- `POST /api/webhooks` body `{ url, events, secret?, enabled? }` → `{ webhook, secret }`
- `PATCH /api/webhooks/:id` body parcial `{ url?, events?, secret?, enabled? }` → `{ webhook }`
- `DELETE /api/webhooks/:id` → 204
- `POST /api/webhooks/:id/test` → `{ ok: boolean }`
- `GET /api/webhooks/:id/deliveries` → `{ deliveries: [{ id, webhookId, event, success, statusCode, attempt, responseExcerpt, createdAt }] }` (últimas 50, desc)
- `POST /api/auth/password` body `{ currentPassword, newPassword }` (mín. 12) → 204

## Convenções do projeto

- React 19, React Router 7, TanStack Query 5, Tailwind v4, tema escuro (`bg-slate-950`, cards `bg-slate-900`, bordas `border-slate-800`, foco `ring-sky-400`).
- UI em PT-BR; sem comentários no código; TypeScript estrito.
- Usar `api` e `ApiRequestError` de `src/web/api.ts`; componentes `Button`, `Card`, `ErrorText`, `Field`, `Input` de `src/web/components/ui.tsx`.
- `useMe` em `src/web/components/ProtectedRoute.tsx` expõe `{ id, username, role, isRoot }`.
- Testes de componente: docblock `// @vitest-environment jsdom`, Testing Library, `QueryClientProvider` com `retry: false`, `vi.stubGlobal('fetch', ...)`, `userEvent`.
- Não criar commits (instrução do usuário). Não alterar arquivos fora do escopo do G4.
- Rotas de definições continuam admin-only; a página de senha fica fora delas e acessível a qualquer autenticado.

## Comportamento esperado

1. **Users.tsx**
   - Manter criação e ativar/desativar.
   - Para usuários não-root, exibir select de papel com `aria-label={`Papel de ${user.username}`}`; ao mudar, enviar `PATCH /api/users/:id` com `{ role }`, atualizar a lista e mostrar erro amigável em falha.
   - Botão `Redefinir senha de ${user.username}` abre um formulário inline com input `Nova senha de ${user.username}` (type password) e botão `Salvar nova senha`; validar mínimo de 12 localmente, enviar `POST /api/users/:id/reset-password` com `{ password }`, limpar/fechar e mostrar aviso de sucesso.
   - Root permanece imutável (sem select/desativar).
2. **Webhooks.tsx**
   - Manter criação e teste; feedback existente de `ok` deve continuar.
   - Botão `Editar` por webhook abre formulário inline preenchido (URL, eventos com checkboxes, `Novo secret (opcional)`, `Ativo`); `Salvar webhook` envia `PATCH /api/webhooks/:id` com `{ url, events, enabled }` e `secret` apenas se preenchido; atualiza a lista.
   - Botão `Excluir` com `window.confirm` envia `DELETE /api/webhooks/:id` e atualiza a lista.
   - Botão `Entregas` carrega `GET /api/webhooks/:id/deliveries` e exibe as últimas 50 (evento, sucesso/falha, status, tentativa, data), com estado vazio.
3. **Password.tsx**
   - Formulário com `Senha atual`, `Nova senha`, `Confirmação da nova senha`; validar nova senha com 12+ e confirmação igual antes de enviar.
   - `POST /api/auth/password` com `{ currentPassword, newPassword }`; sucesso mostra “Senha alterada.” e limpa o formulário; erro mostra a mensagem da API.
   - Rota `/password` em `src/web/app.tsx` dentro do `Layout`; link “Senha” no shell (`Layout.tsx`) visível para todos os autenticados.

## Testes obrigatórios

- `tests/web/users.test.tsx`:
  - alterar o papel de um usuário envia PATCH com `{ role: 'operator' }`;
  - redefinir senha envia POST com `{ password: '...' }` (12+).
- `tests/web/webhooks.test.tsx` (estender):
  - editar webhook envia PATCH com URL/eventos e secret quando preenchido;
  - excluir envia DELETE;
  - listar entregas chama o endpoint e renderiza os dados.
- `tests/web/password.test.tsx`:
  - senha curta (<12) ou confirmação divergente não envia POST e mostra erro;
  - senha válida envia POST com `currentPassword`/`newPassword`.

## Verificação

Rodar os testes focados, depois `bun run typecheck`, `bun run lint`, `bun run test`, `bun run build`. Reportar resultados no arquivo de relatório.
