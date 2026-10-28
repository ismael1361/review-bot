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

describe('README', () => {
  it.each([
    '## Instalação rápida (sem .env)',
    '## Configuração',
    '## Primeiro acesso',
    '## Backup e restauração',
    '## Solução de problemas',
  ])('tem o título %s', (heading) => {
    expect(headingLines).toContain(heading);
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
