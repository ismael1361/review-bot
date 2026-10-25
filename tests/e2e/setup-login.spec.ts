import { expect, test } from '@playwright/test';

test('setup, dashboard, logout e login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup/);

  await page.getByLabel('Token de setup', { exact: true }).fill('token-de-setup-e2e-123456');
  await page.getByLabel('Usuário root', { exact: true }).fill('root');
  await page.getByLabel('Senha', { exact: true }).fill('senha-muito-segura');
  await page.getByLabel('Confirmação da senha', { exact: true }).fill('senha-muito-segura');
  await page.getByRole('button', { name: 'Criar root' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Usuário', { exact: true }).fill('root');
  await page.getByLabel('Senha', { exact: true }).fill('senha-muito-segura');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
