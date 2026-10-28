import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const repo = argument('repo');
const tag = argument('tag');
const image = argument('image');
const out = argument('out');

if (!repo || !tag || !image || !out) {
  console.error('Uso: node render-release-body.mjs --repo owner/repo --tag vX.Y.Z --image ghcr.io/owner/review-bot --out arquivo.md');
  process.exit(2);
}

const template = readFileSync(join(here, 'RELEASE_BODY.template.md'), 'utf8').replace(/\r\n/g, '\n');
const body = template
  .replaceAll('{{REPO}}', repo)
  .replaceAll('{{TAG}}', tag)
  .replaceAll('{{IMAGE}}', image);

writeFileSync(out, body);
