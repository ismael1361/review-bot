import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = join(process.cwd(), 'src', 'web');

describe('index.html', () => {
  it('declara um favicon existente para evitar 404 no navegador', () => {
    const html = readFileSync(join(webRoot, 'index.html'), 'utf8');
    expect(html).toMatch(/<link[^>]+rel="icon"[^>]+href="\/favicon\.svg"/);
    expect(existsSync(join(webRoot, 'public', 'favicon.svg'))).toBe(true);
  });
});
