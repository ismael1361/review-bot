## Instalação sem git

Baixe o zip da arquitetura correta, descompacte e rode o instalador. A imagem Docker já vai dentro do zip.

### Linux/macOS (amd64)

```bash
curl -fL -o review-bot-amd64.zip \
  https://github.com/{{REPO}}/releases/latest/download/review-bot-amd64.zip
unzip review-bot-amd64.zip
cd review-bot-amd64
./install.sh
```

### Linux/macOS (arm64)

```bash
curl -fL -o review-bot-arm64.zip \
  https://github.com/{{REPO}}/releases/latest/download/review-bot-arm64.zip
unzip review-bot-arm64.zip
cd review-bot-arm64
./install.sh
```

### Windows PowerShell (amd64)

```powershell
Invoke-WebRequest -Uri https://github.com/{{REPO}}/releases/latest/download/review-bot-amd64.zip -OutFile review-bot-amd64.zip
Expand-Archive review-bot-amd64.zip -DestinationPath .
cd review-bot-amd64
.\install.ps1
```

### Windows PowerShell (arm64)

```powershell
Invoke-WebRequest -Uri https://github.com/{{REPO}}/releases/latest/download/review-bot-arm64.zip -OutFile review-bot-arm64.zip
Expand-Archive review-bot-arm64.zip -DestinationPath .
cd review-bot-arm64
.\install.ps1
```

Depois abra `http://localhost:7080` e conclua o wizard de setup.

Para uma versão específica, troque `latest` por `download/{{TAG}}` no caminho da release. A imagem também está disponível no GHCR como `{{IMAGE}}:{{TAG}}`.

Documentação completa: https://github.com/{{REPO}}#instalação-rápida-release-sem-git
