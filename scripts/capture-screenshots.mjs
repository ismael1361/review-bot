import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://localhost:7080';
const user = process.env.DEMO_USER ?? 'root';
const password = process.env.DEMO_PASSWORD ?? 'senha-muito-segura';
const reviewId = process.env.DEMO_REVIEW_ID ?? 'demo-review';
const outDir = fileURLToPath(new URL('../docs/images/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const statusResponse = await fetch(`${base}/api/setup/status`);
if (!statusResponse.ok) {
  throw new Error(`Falha ao consultar /api/setup/status em ${base}: HTTP ${statusResponse.status}`);
}
const setupStatus = await statusResponse.json();
if (setupStatus?.needsSetup !== true) {
  throw new Error(`A instância em ${base} já foi configurada; use um DATA_DIR limpo para capturar o wizard`);
}
const envSetupToken = process.env.DEMO_SETUP_TOKEN;
if (setupStatus?.tokenSource === 'env' && !envSetupToken) {
  throw new Error('A instância usa SETUP_TOKEN; defina DEMO_SETUP_TOKEN com o mesmo valor para capturar');
}

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  await page.goto(`${base}/setup`);
  const tokenField = page.getByLabel('Token de setup');
  await tokenField.waitFor();
  let token = '';
  if (setupStatus.tokenSource === 'env') {
    await tokenField.fill(envSetupToken);
    token = envSetupToken;
  } else {
    for (let attempt = 0; attempt < 50 && token.length === 0; attempt += 1) {
      token = await tokenField.inputValue();
      if (token.length === 0) {
        await page.waitForTimeout(100);
      }
    }
    if (token.length === 0) {
      throw new Error('O wizard de setup não exibiu o token gerado');
    }
  }
  await page.screenshot({ path: join(outDir, 'setup.png'), fullPage: true });

  await page.getByLabel('Usuário', { exact: true }).fill(user);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByLabel('Confirmar senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Criar root' }).click();

  await page.getByRole('heading', { name: 'GitHub' }).waitFor();
  await page.getByRole('button', { name: 'Pular por agora' }).click();

  await page.getByRole('heading', { name: 'Perfil de IA' }).waitFor();
  await page.getByRole('button', { name: 'Pular por agora' }).click();

  await page.getByRole('heading', { name: 'Configurações da instância' }).waitFor();
  await page.getByLabel('URL pública', { exact: true }).fill(base);
  await page.getByRole('button', { name: 'Concluir' }).click();

  await page.getByRole('heading', { name: 'Dashboard' }).waitFor();
  await page.getByText('acme/demo').first().waitFor();
  await page.screenshot({ path: join(outDir, 'dashboard.png'), fullPage: true });

  await page.goto(`${base}/queue`);
  await page.getByRole('heading', { name: 'Fila' }).waitFor();
  await page.getByText('acme/demo').first().waitFor();
  await page.screenshot({ path: join(outDir, 'queue.png'), fullPage: true });

  await page.goto(`${base}/reviews/${reviewId}`);
  await page.getByRole('heading', { name: 'Adiciona cache de sessões' }).waitFor();
  await page.getByText('Corpo do review').waitFor();
  await page.screenshot({ path: join(outDir, 'review-detail.png'), fullPage: true });

  await page.goto(`${base}/settings`);
  await page.getByRole('heading', { name: 'Definições' }).waitFor();
  await page.getByRole('heading', { name: 'Conta GitHub' }).waitFor();
  await page.screenshot({ path: join(outDir, 'settings.png'), fullPage: true });
} finally {
  await browser.close();
}
