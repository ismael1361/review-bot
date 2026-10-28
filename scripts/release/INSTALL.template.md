# review-bot {{TAG}} — instalação ({{ARCH}})

Você baixou `{{BUNDLE}}.zip`. Este pacote contém a imagem Docker, o compose e os instaladores. Não é necessário usar git nem construir a imagem.

## Requisitos

- Docker Engine (Linux) ou Docker Desktop (macOS/Windows) com Docker Compose v2.
- Arquitetura `{{ARCH}}` (a maioria dos PCs é `amd64`; servidores ARM e Macs Apple Silicon são `arm64`).

## Instalar

Linux/macOS:

```bash
chmod +x install.sh
./install.sh
```

Windows PowerShell:

```powershell
.\install.ps1
```

O instalador carrega `review-bot-image.tar`, sobe o compose e aguarda o healthcheck. Depois abra:

```text
http://localhost:7080
```

O wizard de setup cria o root e guia a configuração de GitHub, IA e instância.

## Arquivos do pacote

- `review-bot-image.tar`: imagem Docker `{{IMAGE_REF}}`.
- `docker-compose.yml`: compose pronto, com volume `review-bot-data` e porta 7080 em loopback.
- `.env.example`: variáveis opcionais (copie para `.env` se precisar customizar).
- `install.sh` / `install.ps1`: instaladores.
- `SHA256SUMS`: checksums dos arquivos.

Verificação opcional dos checksums:

```bash
sha256sum -c SHA256SUMS
```

No macOS, use `shasum -a 256 -c SHA256SUMS`. No Windows, use `Get-FileHash` para comparar com os valores de `SHA256SUMS`.

## Atualização

1. Faça backup do volume `review-bot-data` e da chave de criptografia.
2. Baixe o zip da nova versão e substitua os arquivos deste diretório.
3. Rode `./install.sh` (ou `.\install.ps1`) novamente. O volume e os dados são preservados.

A imagem também é publicada no GHCR como `{{IMAGE_REF}}`.
