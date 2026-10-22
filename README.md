# review-bot

Painel e automação de review de Pull Requests. Esta fase entrega a fundação: setup do root, autenticação, usuários com papéis, definições de GitHub, perfis de IA, skills, webhooks, repositórios, fila (somente leitura), dashboard e SSE. O poller e o worker de review chegam na próxima fase.

## Instalação

1. Copie `.env.example` para `.env` e gere a chave: `openssl rand -base64 32` em `APP_ENCRYPTION_KEY`.
2. Ajuste `PUBLIC_URL` para a URL pública (o TLS fica a cargo do seu proxy reverso).
3. `docker compose up -d`.
4. Leia o token de setup: `docker compose logs app`.
5. Acesse o painel e crie o usuário root.

## Desenvolvimento

- `yarn install`
- `yarn dev` (API em http://localhost:3000)
- `yarn dev:web` (SPA em http://localhost:5173 com proxy para a API)
- `yarn test`, `yarn typecheck`, `yarn lint`

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `APP_ENCRYPTION_KEY` | 32 bytes em base64 (obrigatória) |
| `SETUP_TOKEN` | Substitui o token de setup gerado |
| `PUBLIC_URL` | URL pública (obrigatória em produção) |
| `DATA_DIR` | Diretório do SQLite (padrão `/data` na imagem) |
| `TRUST_PROXY` | Confia em cabeçalhos do proxy |
| `ALLOW_PRIVATE_URLS` | Permite provedores/webhooks em rede privada |

## Backup

Com o container em execução, copie `data/review-bot.db` usando `sqlite3 .backup` ou pare o container antes de copiar (WAL). O script de backup automatizado chega na fase de operação.
