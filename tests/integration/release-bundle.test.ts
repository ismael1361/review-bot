import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assembleBundle } from '../../scripts/release/assemble-bundle.mjs';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'review-bot-bundle-'));
  dirs.push(dir);
  return dir;
}

function zipEntries(zipPath: string): string[] {
  if (process.platform === 'win32') {
    const output = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [IO.Compression.ZipFile]::OpenRead('${zipPath.replace(/'/g, "''")}'); try { $zip.Entries | ForEach-Object { $_.FullName } } finally { $zip.Dispose() }`,
      ],
      { encoding: 'utf8' },
    );
    return output.split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/\\/g, '/'));
  }
  return execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function assertShellSyntax(path: string): void {
  const bash = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';
  if (!existsSync(bash)) {
    return;
  }
  execFileSync(bash, ['-n', path], { stdio: 'pipe' });
}

function assertPowerShellSyntax(path: string): void {
  if (process.platform !== 'win32') {
    return;
  }
  execFileSync(
    'powershell',
    ['-NoProfile', '-Command', `$null = [ScriptBlock]::Create((Get-Content -Raw '${path.replace(/'/g, "''")}'))`],
    { stdio: 'pipe' },
  );
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('assembleBundle', () => {
  it('monta o zip autocontido por arquitetura com compose, instaladores e checksums', async () => {
    const root = tempDir();
    const tarPath = join(root, 'image.tar');
    writeFileSync(tarPath, 'fake-image-tar');

    const result = await assembleBundle({
      arch: 'amd64',
      image: 'ghcr.io/acme/review-bot',
      tag: 'v1.2.3',
      repo: 'acme/review-bot',
      tarPath,
      outDir: join(root, 'out'),
      templatesDir: join(process.cwd(), 'scripts', 'release'),
    });

    expect(result.zipPath).toBe(join(root, 'out', 'review-bot-amd64.zip'));
    expect(existsSync(result.zipPath)).toBe(true);
    expect(readFileSync(join(result.stagingDir, 'review-bot-image.tar'), 'utf8')).toBe('fake-image-tar');

    const compose = readFileSync(join(result.stagingDir, 'docker-compose.yml'), 'utf8');
    expect(compose).toContain('image: ghcr.io/acme/review-bot:v1.2.3');
    expect(compose).not.toContain('__IMAGE__');
    expect(compose).not.toContain('build:');

    expect(readFileSync(join(result.stagingDir, '.env.example'), 'utf8')).toContain('PORT=7080');

    const installSh = readFileSync(join(result.stagingDir, 'install.sh'), 'utf8');
    expect(installSh).toContain('docker load');
    expect(installSh).toContain('docker compose up -d --wait');
    expect(installSh).toContain('amd64');
    assertShellSyntax(join(result.stagingDir, 'install.sh'));

    const installPs1 = readFileSync(join(result.stagingDir, 'install.ps1'), 'utf8');
    expect(installPs1).toContain('docker load');
    expect(installPs1).toContain('docker compose up -d --wait');
    expect(installPs1).toContain('amd64');
    assertPowerShellSyntax(join(result.stagingDir, 'install.ps1'));

    const installMd = readFileSync(join(result.stagingDir, 'INSTALL.md'), 'utf8');
    expect(installMd).toContain('review-bot-amd64.zip');
    expect(installMd).toContain('./install.sh');
    expect(installMd).toContain('.\\install.ps1');
    expect(installMd).toContain('http://localhost:7080');

    const sums = readFileSync(join(result.stagingDir, 'SHA256SUMS'), 'utf8');
    const imageHash = createHash('sha256').update('fake-image-tar').digest('hex');
    expect(sums).toContain(`${imageHash}  review-bot-image.tar`);
    expect(sums).toMatch(/review-bot-image\.tar/);
    expect(sums).toMatch(/docker-compose\.yml/);
    expect(sums).toMatch(/install\.sh/);
    expect(sums).toMatch(/install\.ps1/);

    const entries = zipEntries(result.zipPath);
    expect(entries).toEqual(
      expect.arrayContaining([
        'review-bot-amd64/review-bot-image.tar',
        'review-bot-amd64/docker-compose.yml',
        'review-bot-amd64/.env.example',
        'review-bot-amd64/INSTALL.md',
        'review-bot-amd64/install.sh',
        'review-bot-amd64/install.ps1',
        'review-bot-amd64/SHA256SUMS',
      ]),
    );
  }, 30_000);

  it('aceita outDir relativo e grava o zip no lugar esperado', async () => {
    const root = tempDir();
    const tarPath = join(root, 'image.tar');
    writeFileSync(tarPath, 'fake-image-tar');
    const outDir = relative(process.cwd(), join(root, 'out'));

    const result = await assembleBundle({
      arch: 'arm64',
      image: 'ghcr.io/acme/review-bot',
      tag: 'v1.2.3',
      repo: 'acme/review-bot',
      tarPath,
      outDir,
      templatesDir: join(process.cwd(), 'scripts', 'release'),
    });

    expect(existsSync(join(root, 'out', 'review-bot-arm64.zip'))).toBe(true);
    expect(existsSync(result.zipPath)).toBe(true);
  });

  it('funciona como CLI usado pelo workflow', () => {
    const root = tempDir();
    const tarPath = join(root, 'image.tar');
    writeFileSync(tarPath, 'fake-image-tar');
    const outDir = join(root, 'out');

    execFileSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'release', 'assemble-bundle.mjs'),
        '--arch',
        'amd64',
        '--image',
        'ghcr.io/acme/review-bot',
        '--tag',
        'v1.2.3',
        '--repo',
        'acme/review-bot',
        '--tar',
        tarPath,
        '--out',
        outDir,
      ],
      { stdio: 'pipe' },
    );

    expect(existsSync(join(outDir, 'review-bot-amd64.zip'))).toBe(true);
  });

  it('renderiza o corpo da release com comandos sem git', () => {
    const root = tempDir();
    const bodyPath = join(root, 'RELEASE_BODY.md');

    execFileSync(
      process.execPath,
      [
        join(process.cwd(), 'scripts', 'release', 'render-release-body.mjs'),
        '--repo',
        'acme/review-bot',
        '--tag',
        'v1.2.3',
        '--image',
        'ghcr.io/acme/review-bot',
        '--out',
        bodyPath,
      ],
      { stdio: 'pipe' },
    );

    const body = readFileSync(bodyPath, 'utf8');
    expect(body).toContain('releases/latest/download/review-bot-amd64.zip');
    expect(body).toContain('releases/latest/download/review-bot-arm64.zip');
    expect(body).toContain('./install.sh');
    expect(body).toContain('.\\install.ps1');
    expect(body).toContain('ghcr.io/acme/review-bot:v1.2.3');
    expect(body).not.toContain('git clone');
  });

  it('recusa arquitetura fora de amd64/arm64', async () => {
    const root = tempDir();
    const tarPath = join(root, 'image.tar');
    writeFileSync(tarPath, 'fake-image-tar');

    await expect(
      assembleBundle({
        arch: 'riscv64' as never,
        image: 'ghcr.io/acme/review-bot',
        tag: 'v1.2.3',
        repo: 'acme/review-bot',
        tarPath,
        outDir: join(root, 'out'),
        templatesDir: join(process.cwd(), 'scripts', 'release'),
      }),
    ).rejects.toThrow(/amd64|arm64/);
  });
});
