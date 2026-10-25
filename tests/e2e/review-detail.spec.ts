import { expect, test } from '@playwright/test';

const payload = {
  review: {
    id: 'rev1',
    body: '<!-- pr-reviewer:job:j1 -->\n**Review técnico da PR #482**\n\nUm achado **crítico** com `idleExpire`.',
    url: 'https://github.com/acme/api/pull/482',
    status: 'posted',
    commentsPosted: 1,
    commentsFallback: 0,
    postedAt: 1,
  },
  job: {
    id: 'j1',
    prTitle: 'fix: valida token',
    prUrl: 'https://github.com/acme/api/pull/482',
    headSha: '9f2c1ab',
    status: 'succeeded',
    usageJson: JSON.stringify({ input: 100, output: 20, turns: 4 }),
  },
  findings: [
    {
      id: 'f1',
      path: 'src/auth/setup.ts',
      endLine: 44,
      severity: 'critical',
      title: 'Token validado antes da expiração',
      bodyMd: 'A sessão é aceita após o `idleExpire`.',
      suggestionMd: '+ return undefined;',
      status: 'posted',
      snippetJson: JSON.stringify({
        lines: [
          { type: 'context', oldLine: 43, newLine: 43, text: '}' },
          { type: 'add', oldLine: null, newLine: 44, text: 'const user = db.select();' },
        ],
        targetLine: 44,
      }),
    },
  ],
  transcript: [],
};

test('detalhe da review renderiza body, diff e markdown', async ({ page }) => {
  await page.route('**/api/setup/status', (route) => route.fulfill({ json: { needsSetup: false } }));
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ json: { user: { id: 'u1', username: 'root', role: 'admin', isRoot: true } } }),
  );
  await page.route('**/api/events', (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ': connected\n\n' }),
  );
  await page.route('**/api/reviews/rev1', (route) => route.fulfill({ json: payload }));

  await page.goto('/reviews/rev1');

  await expect(page.getByRole('heading', { name: 'fix: valida token' })).toBeVisible();

  const reviewBody = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Corpo do review' }) });
  await expect(reviewBody.locator('strong', { hasText: 'Review técnico da PR #482' })).toBeVisible();
  await expect(page.getByText('**Review técnico', { exact: false })).toHaveCount(0);
  await expect(page.getByText('`idleExpire`', { exact: false })).toHaveCount(0);

  const findings = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Achados (1)' }) });
  const finding = findings.locator('li').filter({ hasText: 'Token validado antes da expiração' });
  await expect(finding).toBeVisible();
  await expect(finding.locator('p', { hasText: 'A sessão é aceita' })).toBeVisible();
  await expect(finding.locator('code', { hasText: 'idleExpire' })).toBeVisible();
  await expect(finding.getByText('linha 44', { exact: true })).toBeVisible();

  const targetLine = finding.getByRole('listitem', { name: 'Linha 44 adicionada' });
  await expect(targetLine).toContainText('const user = db.select();');

  await expect(page.getByText(/pr-reviewer:job/)).toHaveCount(0);
});
