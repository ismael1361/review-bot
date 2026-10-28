import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ARCHS = new Set(['amd64', 'arm64']);

function render(template, values) {
  let output = template.replace(/\r\n/g, '\n');
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeChecksums(stagingDir, files) {
  const lines = files.map((file) => `${hashFile(join(stagingDir, file))}  ${file}`);
  writeFileSync(join(stagingDir, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}

function createZip(outDir, bundleName, zipPath) {
  if (process.platform === 'win32') {
    const source = join(outDir, bundleName).replace(/'/g, "''");
    const destination = zipPath.replace(/'/g, "''");
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -LiteralPath '${source}' -DestinationPath '${destination}' -Force`,
      ],
      { stdio: 'pipe' },
    );
    return;
  }
  execFileSync('zip', ['-r', '-q', zipPath, bundleName], { cwd: outDir, stdio: 'pipe' });
}

export async function assembleBundle(input) {
  const { arch, image, tag, repo, tarPath, outDir, templatesDir } = input;
  if (!ARCHS.has(arch)) {
    throw new Error(`Arquitetura inválida: ${arch}; use amd64 ou arm64`);
  }
  if (!existsSync(tarPath) || statSync(tarPath).size === 0) {
    throw new Error(`Tar da imagem ausente ou vazio: ${tarPath}`);
  }

  const repoRoot = resolve(templatesDir, '..', '..');
  const composeSource = input.composePath ?? join(repoRoot, 'docker-compose.release.yml');
  const envSource = join(repoRoot, '.env.example');
  const imageRef = `${image}:${tag}`;
  const bundleName = `review-bot-${arch}`;
  const outputDir = resolve(outDir);
  const stagingDir = join(outputDir, bundleName);
  const zipPath = join(outputDir, `${bundleName}.zip`);

  mkdirSync(outputDir, { recursive: true });
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  mkdirSync(stagingDir, { recursive: true });

  copyFileSync(tarPath, join(stagingDir, 'review-bot-image.tar'));

  const compose = readFileSync(composeSource, 'utf8')
    .replace(/\r\n/g, '\n')
    .replaceAll('__IMAGE__', imageRef);
  if (compose.includes('__IMAGE__')) {
    throw new Error('Placeholder __IMAGE__ não foi substituído no compose');
  }
  writeFileSync(join(stagingDir, 'docker-compose.yml'), compose);
  copyFileSync(envSource, join(stagingDir, '.env.example'));

  const values = {
    ARCH: arch,
    BUNDLE: bundleName,
    IMAGE: image,
    IMAGE_REF: imageRef,
    TAG: tag,
    REPO: repo,
  };
  for (const [source, target] of [
    ['install.sh.template', 'install.sh'],
    ['install.ps1.template', 'install.ps1'],
    ['INSTALL.template.md', 'INSTALL.md'],
  ]) {
    const template = readFileSync(join(templatesDir, source), 'utf8');
    writeFileSync(join(stagingDir, target), render(template, values));
  }
  if (process.platform !== 'win32') {
    chmodSync(join(stagingDir, 'install.sh'), 0o755);
  }

  writeChecksums(stagingDir, [
    'review-bot-image.tar',
    'docker-compose.yml',
    '.env.example',
    'INSTALL.md',
    'install.sh',
    'install.ps1',
  ]);

  createZip(outputDir, bundleName, zipPath);
  return { bundleName, stagingDir, zipPath };
}

function argument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const arch = argument('arch');
  const image = argument('image');
  const tag = argument('tag');
  const repo = argument('repo');
  const tarPath = argument('tar');
  const outDir = argument('out');

  if (!arch || !image || !tag || !repo || !tarPath || !outDir) {
    console.error(
      'Uso: node assemble-bundle.mjs --arch amd64|arm64 --image ghcr.io/owner/review-bot --tag vX.Y.Z --repo owner/repo --tar imagem.tar --out diretório',
    );
    process.exit(2);
  }

  const result = await assembleBundle({
    arch,
    image,
    tag,
    repo,
    tarPath,
    outDir,
    templatesDir: dirname(fileURLToPath(import.meta.url)),
  });
  console.log(`wrote ${result.zipPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
