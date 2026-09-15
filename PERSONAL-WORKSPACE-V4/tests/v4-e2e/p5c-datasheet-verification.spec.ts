import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function data<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!response.ok()) throw new Error(`${response.status()}: ${await response.text()}`);
  return ((await response.json()) as { data: T }).data;
}

async function createProject(request: APIRequestContext, name: string): Promise<string> {
  const project = await data<{ project: { id: string } }>(
    await request.post('/api/projects', {
      data: {
        projectName: name,
        clientName: 'Disposable P5C Client',
        projectType: 'Lighting Design',
        description: 'Disposable exact Datasheet verification.',
        siteLocation: 'Synthetic Site',
        designStage: 'DetailedDesign',
        lightingScope: 'Datasheet verification only.',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 1,
        requiredDeliveryDate: '2028-12-15',
        idempotencyKey: randomUUID(),
      },
    }),
  );
  return project.project.id;
}

test('P5C verifies one exact attached Datasheet and adopts only one Project field', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const projectId = await createProject(request, 'P5C Datasheet Verification');
  const fixture = await data<{ luminaireId: string; assetVersionId: string }>(
    await request.post('/api/test/p5c-datasheet-verification/seed', {
      data: { projectId },
    }),
  );

  await page.goto(`/v4/projects/${projectId}/technical-check`);
  await page.getByRole('button', { name: 'Run Technical Check' }).click();
  await page.locator('button[aria-haspopup="listbox"][aria-label="Result"]').click();
  await page.getByRole('option', { name: 'All', exact: true }).click();
  const luminaireRow = page.getByRole('button', { name: /^A100-UAT: \d+ checks$/ });
  await expect(luminaireRow).toBeVisible();
  await luminaireRow.getByRole('button', { name: /^Review A100-UAT: \d+ checks$/ }).click();

  const dialog = page.getByRole('dialog', {
    name: 'Technical Verification — A100-UAT',
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Show differences only')).toBeChecked();

  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of [
      { width: 1080, height: 900 },
      { width: 1440, height: 900 },
      { width: 1672, height: 941 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.evaluate((value) => {
        window.localStorage.setItem('scli.v4.theme', value);
        document.documentElement.dataset.theme = value;
      }, theme);
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const path = testInfo.outputPath(
        `technical-verification-${theme}-${viewport.width}x${viewport.height}.png`,
      );
      await page.screenshot({ path, fullPage: false });
      await testInfo.attach(`technical-verification-${theme}-${viewport.width}`, {
        path,
        contentType: 'image/png',
      });
    }
  }

  const systemPower = dialog.getByRole('button', { name: 'System Power' });
  await systemPower.click();
  await expect(dialog.getByText(/Native PDF · HIGH confidence/)).toBeVisible();
  await expect(dialog.getByRole('navigation', { name: 'Field detail pages' })).toHaveCount(0);
  await dialog
    .getByRole('region', { name: 'Field evidence' })
    .getByRole('button', { name: 'View Evidence' })
    .click();
  await expect(dialog.getByAltText('Bounded Datasheet evidence page 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Review reading', exact: true }).click();
  await dialog.getByRole('button', { name: 'Use Datasheet Value' }).click();
  await page
    .getByRole('dialog', { name: 'Confirm action', exact: true })
    .getByRole('button', { name: 'Continue', exact: true })
    .click();
  await expect(systemPower).toHaveCount(0);
  await expect(dialog).toBeVisible();

  const workspace = await data<{
    luminaires: Array<{
      id: string;
      wattage: string;
      lumens: string;
      beamAngle: string;
      ipRating: string;
    }>;
  }>(await request.get(`/api/projects/${projectId}/workspace`));
  expect(workspace.luminaires.find((item) => item.id === fixture.luminaireId)).toMatchObject({
    wattage: '15 W',
    lumens: '1200 lm',
    beamAngle: '24°',
    ipRating: 'IP44',
  });
});

test('P5C rejects Datasheet bytes that do not match the exact AssetVersion SHA-256', async ({
  request,
}) => {
  const projectId = await createProject(request, 'P5C Datasheet Hash Rejection');
  const fixture = await data<{ luminaireId: string }>(
    await request.post('/api/test/p5c-datasheet-verification/seed', {
      data: { projectId, corruptStoredHash: true },
    }),
  );
  const response = await request.post(
    `/api/projects/${projectId}/luminaires/${fixture.luminaireId}/analyze-datasheet`,
  );
  expect(response.status()).toBe(409);
  expect(await response.text()).toContain('could not be verified');
});
