import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

test('profile photo survives reload and can return to initials', async ({ page }) => {
  const png = new PNG({ width: 16, height: 16 });
  png.data.fill(255);
  await page.goto('/v4/settings');
  const avatar = page.getByRole('button', { name: 'Edit my profile', exact: true });
  await avatar.click();
  const editor = page.getByRole('dialog', { name: 'My Profile' });
  await editor.getByLabel('Name', { exact: true }).fill('Photo Test Owner');
  await editor.getByLabel('Choose avatar image').setInputFiles({
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: PNG.sync.write(png),
  });
  await expect(editor.getByAltText('Avatar preview')).toBeVisible();
  await editor.getByRole('button', { name: 'Save Profile' }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await expect(avatar.locator('img')).toBeVisible();
  await avatar.click();
  await editor.getByRole('button', { name: 'Use Initials' }).click();
  await editor.getByRole('button', { name: 'Save Profile' }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await expect(avatar).toHaveText('PTO');
  await expect(avatar.locator('img')).toHaveCount(0);
});

test('approved profile edit persists, report charts render and retired navigation stays hidden', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/v4/reports');
  await expect(page.getByRole('button', { name: 'Edit my profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit my profile' }).click();
  const editor = page.getByRole('dialog', { name: 'My Profile' });
  await expect(editor).toBeVisible();
  await editor.getByLabel('Name', { exact: true }).fill('QA Profile Owner');
  await editor.getByLabel('Email', { exact: true }).fill('qa.profile@example.test');
  await editor.getByRole('button', { name: 'Save Profile' }).click();
  await expect(editor).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Edit my profile' }).click();
  await expect(
    page.getByRole('dialog', { name: 'My Profile' }).getByLabel('Name', { exact: true }),
  ).toHaveValue('QA Profile Owner');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Workload by sales owner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Document Review', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/approved-reports.png', fullPage: true });
});

test('library shows a company without products in dark mode', async ({ page, request }) => {
  const manufacturerResponse = await request.post('/api/luminaire-library/manufacturers', {
    data: { name: 'QA Empty Manufacturer', idempotencyKey: crypto.randomUUID() },
  });
  expect(manufacturerResponse.ok()).toBe(true);
  await page.goto('/v4/luminaire-library');
  await page.evaluate(() => localStorage.setItem('scli.v4.theme', 'dark'));
  await page.reload();
  await expect(page.getByText('QA Empty Manufacturer', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'test-results/approved-library-dark.png', fullPage: true });
});

test('library comparison opens a real draft and explains unpublished state', async ({
  page,
  request,
}) => {
  const company = await request.post('/api/luminaire-library/manufacturers', {
    data: { name: 'QA Compare Company', idempotencyKey: crypto.randomUUID() },
  });
  expect(company.ok()).toBe(true);
  const manufacturerId = (await company.json()).data.manufacturerId;
  const productResponse = await request.post('/api/luminaire-library/products', {
    data: {
      manufacturerId,
      name: 'QA Compare Product',
      productType: 'Spotlight',
      description: 'Disposable comparison fixture',
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(productResponse.ok()).toBe(true);
  const productId = (await productResponse.json()).data.productId;
  const variantResponse = await request.post(
    `/api/luminaire-library/products/${productId}/variants`,
    {
      data: {
        variantLabel: 'QA 12W',
        orderingCode: 'QA-12',
        wattage: '12W',
        lumens: '1000 lm',
        lightColor: '3000K',
        cri: '90',
        beamAngle: '24',
        ipRating: 'IP20',
        mounting: 'Track',
        cutout: '',
        driver: 'Integral',
        control: 'DALI',
        emergency: 'No',
        dimensions: '100 mm',
        bodyColorFinish: 'White',
        idempotencyKey: crypto.randomUUID(),
      },
    },
  );
  expect(variantResponse.ok()).toBe(true);
  const variantId = (await variantResponse.json()).data.variantId;
  await page.goto(`/v4/luminaire-library?productId=${productId}&variantId=${variantId}`);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Compare variant' })).toBeVisible();
  await expect(page.getByText('No published version exists for this variant yet.')).toBeVisible();
});

test('approved pages render with custom icons in light and dark themes', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180000);
  const response = await request.post('/api/projects', {
    data: {
      projectName: 'Approved UI Theme Audit',
      clientName: 'Disposable UI Client',
      projectType: 'Lighting Layout',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'Disposable theme audit',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: '2027-12-01',
      createFolders: false,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const projectId = (await response.json()).data.project.id;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1600, height: 1000 });
  const routes = [
    'dashboard',
    'projects',
    'reports',
    'settings',
    'imports',
    'luminaire-library',
    ...[
      'summary',
      'workflow-timeline',
      'scope',
      'actions',
      'meetings',
      'comments',
      'contacts',
      'luminaires',
      'datasheets-images',
      'technical-check',
      'revisions',
      'packages',
      'files',
    ].map((s) => `projects/${projectId}/${s}`),
  ];
  for (const theme of ['light', 'dark']) {
    await page.goto('/v4/settings');
    await page.evaluate((value) => localStorage.setItem('scli.v4.theme', value), theme);
    for (const route of routes) {
      await page.goto(`/v4/${route}`);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(
        page.getByRole('button', { name: 'Edit my profile', exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Page not found', { exact: true })).toHaveCount(0);
      await expect(page.locator('.lucide')).toHaveCount(0);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, route).toBe(false);
      await page.screenshot({
        path: testInfo.outputPath(`${theme}-${route.split('/').at(-1)}.png`),
      });
    }
  }
  expect(errors).toEqual([]);
});
