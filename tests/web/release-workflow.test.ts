import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');
const assembler = readFileSync(join(process.cwd(), 'scripts', 'release', 'assemble-bundle.mjs'), 'utf8');

describe('workflow de release', () => {
  it('publica a imagem multi-arch no GHCR e mantém o gate de testes', () => {
    expect(workflow).toContain('needs: test');
    expect(workflow).toContain('docker/setup-buildx-action');
    expect(workflow).toContain('docker/build-push-action');
    expect(workflow).toContain('platforms: linux/amd64,linux/arm64');
    expect(workflow).toContain('type=ref,event=tag');
    expect(workflow).toContain('ghcr.io');
  });

  it('exporta cada arquitetura e gera zips autocontidos com instaladores', () => {
    expect(workflow).toContain('docker save');
    expect(workflow).toContain('--platform');
    expect(workflow).toContain('assemble-bundle.mjs');
    expect(workflow).toContain('review-bot-amd64.zip');
    expect(workflow).toContain('review-bot-arm64.zip');
    expect(assembler).toContain('install.sh.template');
    expect(assembler).toContain('install.ps1.template');
    expect(workflow).toContain('body_path');
    expect(workflow).toContain('softprops/action-gh-release');
  });

  it('não orienta o usuário final a clonar o repositório', () => {
    expect(workflow).not.toContain('git clone');
    expect(workflow).not.toContain('git pull');
  });
});
