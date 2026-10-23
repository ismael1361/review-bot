# G3 — CRUD de perfis e skills no painel

**Files:** `src/web/pages/settings/Profiles.tsx`, `Skills.tsx`, `src/web/pages/settings/index.tsx`, tests.

**Requisitos:**

- Perfis: editar (nome, provedor, baseUrl, modelo, chave opcional, temperatura, limites, pré-prompt, skills com checkboxes ordenados), excluir (não ativo), testar e ativar; formulário completo no create.
- Skills: editar e excluir com confirmação; exibir conteúdo.
- Abas de definições visíveis por papel (admin vê tudo; operator/viewer só leitura ou abas permitidas), com defesa no servidor já existente.
- Testes de componente: edição de perfil envia PUT com campos e skillIds; exclusão de skill chama DELETE; abas escondidas para viewer.

## Global Constraints (Plano 1.5)

- Yarn 4 (`yarn ...`), sem pnpm; sem git/commits; TypeScript estrito; sem comentários; UI PT-BR e tema escuro.
- Toda tarefa termina com testes focados + `yarn typecheck`, `yarn lint`, `yarn test`, `yarn build`.
- Não alterar o comportamento já coberto sem atualizar os testes.

## Contexto do repositório

- O gerenciador foi migrado para Bun no commit `b7def14`; usar `bun run ...` para os mesmos scripts.
- O spec restringe todas as rotas de `/api/settings/*`, `/api/ai-profiles`, `/api/skills`, `/api/users` e `/api/webhooks` a `admin`; portanto operator/viewer não têm abas permitidas.
