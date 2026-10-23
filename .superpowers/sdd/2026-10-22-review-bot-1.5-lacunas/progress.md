# SDD ledger — plan: D:\projetos\review-bot\docs\superpowers\plans\2026-10-22-review-bot-1.5-lacunas.md

Constraint: sem git/commits (instrução do usuário). Revisões leem arquivos diretamente.

## Progresso

G1: complete (audit GET, rate limits, Referer, dummy hash, users tx/race, purge; review found limiter sem teto → fix round 1 addressed; 106/106 testes, build limpo)
G1: minor (deferred): sem teste de integração do limiter de 120/min; O(n) sweep quando saturado; page de auditoria sem limite superior; corrida de username não testada
Ruling: limiter com maxEntries 10.000 e falha fechada para chaves novas quando cheio — custo: sob ataque, sessões novas podem receber 429 até expirar a janela.
G2: complete (health real, SSE com reauth/cap/cleanup; review 2 Important de error boundary → fix round 1 addressed; 111/111 testes, build limpo)
G2: minor (deferred): SSE estende idle a cada evento; cap global sem quota por usuário; backpressure ignorado; sem teste de recuperação de slot
Ruling: G3 já implementado no commit be19051, apesar do ledger dizer "não iniciada" — verificar/revisar em vez de reimplementar. Custo se errado: lacuna passa despercebida ou retrabalho desnecessário.
G3: complete (código já presente em be19051; revisão clean, sem Critical/Important; focados 5/5, suíte 120/120, typecheck/lint/build limpos; nenhuma alteração de código necessária).
G3: minor (deferred): números vazios viram 0 em Profiles; apiKey enviada sem trim; teste de abas só cobre viewer (falta caso admin); messageFor/textarea duplicados entre Profiles e Skills; baseUrl padrão não muda ao trocar provedor; cobertura ausente de create com chave, apiKey no edit e botão excluir do perfil ativo.
G4: complete (review clean, sem Critical/Important; focados 12/12, suíte 130/130, typecheck/lint/build limpos; sem commits).
G4: minor (deferred): avisos de sucesso não são limpos por ações seguintes em Users/Webhooks; uma mutation desabilita controles de todas as linhas; submit de senha sem guarda de duplo clique; cobertura ausente de validação local de reset, falha de papel, feedback ok=true e data das entregas; messageFor duplicado.
G4: preflight — Users.tsx e Webhooks.tsx existentes serão estendidos; app.tsx ganha rota /password; Layout ganha link; rotas de servidor já existentes cobrem todas as ações (PATCH/POST/DELETE/GET), sem mudanças de API previstas. Sem conflito com G5 (useEvents/Audit ficam para depois).
G5: pendente.

