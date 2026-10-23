# SDD ledger — plan: D:\projetos\review-bot\docs\superpowers\plans\2026-10-22-review-bot-1.5-lacunas.md

Constraint: sem git/commits (instrução do usuário). Revisões leem arquivos diretamente.

## Progresso

G1: complete (audit GET, rate limits, Referer, dummy hash, users tx/race, purge; review found limiter sem teto → fix round 1 addressed; 106/106 testes, build limpo)
G1: minor (deferred): sem teste de integração do limiter de 120/min; O(n) sweep quando saturado; page de auditoria sem limite superior; corrida de username não testada
Ruling: limiter com maxEntries 10.000 e falha fechada para chaves novas quando cheio — custo: sob ataque, sessões novas podem receber 429 até expirar a janela.
G2: complete (health real, SSE com reauth/cap/cleanup; review 2 Important de error boundary → fix round 1 addressed; 111/111 testes, build limpo)
G2: minor (deferred): SSE estende idle a cada evento; cap global sem quota por usuário; backpressure ignorado; sem teste de recuperação de slot
Pausa: G3 (CRUD de perfis/skills + abas por papel) não iniciada — dispatch abortado pelo usuário; G4 e G5 pendentes.

