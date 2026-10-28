import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const headingLines = readme.split(/\r?\n/).filter((line) => line.startsWith('## '));
const imagePaths = [...new Set(readme.match(/docs\/images\/[\w.-]+\.png/g) ?? [])];
const expectedImages = ['setup', 'dashboard', 'queue', 'review-detail', 'settings'].map(
  (name) => `docs/images/${name}.png`,
);

function section(title: string): string {
  const start = readme.indexOf(`## ${title}`);
  if (start === -1) {
    return '';
  }
  const end = readme.indexOf('\n## ', start + 1);
  return readme.slice(start, end === -1 ? undefined : end);
}

describe('README', () => {
  it.each([
    '## Instalação rápida (release, sem git)',
    '## Configuração',
    '## Primeiro acesso',
    '## Backup e restauração',
    '## Solução de problemas',
  ])('tem o título %s', (heading) => {
    expect(headingLines).toContain(heading);
  });

  it('usa o repositório real nos comandos de release', () => {
    expect(readme).toContain('https://github.com/ismael1361/review-bot');
    expect(readme).not.toContain('<owner>');
  });

  it('ensina a instalar pelo zip da release sem git', () => {
    const quickStart = section('Instalação rápida (release, sem git)');
    expect(quickStart).toContain('releases/latest/download/review-bot-amd64.zip');
    expect(quickStart).toContain('unzip review-bot-amd64.zip');
    expect(quickStart).toContain('./install.sh');
    expect(quickStart).toContain('.\\install.ps1');
    expect(quickStart).toContain('http://localhost:7080');
    expect(quickStart).not.toContain('git clone');
    expect(quickStart).not.toContain('docker compose up -d --build');
  });

  it('referencia apenas imagens existentes em docs/images', () => {
    expect(imagePaths.length).toBeGreaterThan(0);
    const missing = imagePaths.filter((path) => !existsSync(join(root, path)));
    expect(missing, `Imagens ausentes: ${missing.join(', ')}`).toEqual([]);
  });

  it('referencia as cinco capturas da documentação', () => {
    const missingReferences = expectedImages.filter((path) => !imagePaths.includes(path));
    expect(missingReferences, `Imagens não referenciadas: ${missingReferences.join(', ')}`).toEqual([]);
    const missingFiles = expectedImages.filter((path) => !existsSync(join(root, path)));
    expect(missingFiles, `Imagens ausentes: ${missingFiles.join(', ')}`).toEqual([]);
  });
});
