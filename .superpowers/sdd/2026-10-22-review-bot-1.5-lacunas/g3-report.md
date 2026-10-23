# G3 — Relatório de verificação (código já presente)

## Status

O G3 já está implementado no commit `be19051` (`feat: fecha lacunas do plano 1.5 (G1 e G2)`), cuja mensagem inclui "permite editar/excluir perfis e skills no painel, com ordenação de skills e restrição das abas de definições a admin". O ledger anterior (`progress.md`) dizia que o G3 não tinha sido iniciado; a verificação do código e do histórico mostrou que a implementação e os testes já estavam versionados. Nenhuma alteração de código foi feita nesta verificação.

## O que já existe

- `src/web/pages/settings/Profiles.tsx`:
  - formulário completo de criação e edição (nome, provedor, baseUrl, modelo, apiKey opcional na edição, temperatura, limites, pré-prompt);
  - skills com checkboxes e ordenação por setas;
  - ações de testar, editar, ativar e excluir (excluir desabilitado para o perfil ativo);
  - PUT em `/api/ai-profiles/:id` com todos os campos e `skillIds` na ordem escolhida.
- `src/web/pages/settings/Skills.tsx`:
  - edição, exclusão com `window.confirm` e exibição do conteúdo Markdown na lista.
- `src/web/pages/settings/index.tsx`:
  - abas de definições visíveis apenas para `admin`; operator/viewer recebem o aviso de acesso restrito. O spec define todas as rotas de definições como admin-only, então não há abas permitidas para os demais papéis.
- Testes:
  - `tests/web/profiles.test.tsx`: PUT com campos e ordem de skills.
  - `tests/web/skills.test.tsx`: exclusão via DELETE e edição via PUT.
  - `tests/web/settings-access.test.tsx`: viewer não vê link/abas de definições.

## Testes focados executados

Comando: `bun run vitest run tests/web/profiles.test.tsx tests/web/skills.test.tsx tests/web/settings-access.test.tsx`

Resultado: 3 arquivos, 5 testes verdes, sem warnings.

## Revisão da tarefa

Revisor independente: **Spec compliant**, **Task quality: Approved**. Nenhum achado Critical ou Important. Seis achados Minor registrados no ledger como deferred (validação numérica, trim da apiKey, caso admin no teste de abas, duplicação de utilitários, baseUrl padrão por provedor e cobertura de create/edição/exclusão).

## Verificação completa

- `bun run typecheck`: ok.
- `bun run lint`: ok.
- `bun run test`: 32 arquivos, 120 testes verdes.
- `bun run build`: ok (web e server).
