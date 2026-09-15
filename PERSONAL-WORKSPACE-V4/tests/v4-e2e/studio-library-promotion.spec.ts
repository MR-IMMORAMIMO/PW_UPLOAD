import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('Studio promotes a project luminaire through the existing reviewed Library draft flow', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/projects', {
    data: {
      projectName: 'Studio Library Promotion',
      clientName: 'Synthetic Client',
      projectType: 'Lighting Design',
      description: 'Disposable Library promotion',
      siteLocation: 'Test Site',
      designStage: 'DetailedDesign',
      lightingScope: 'Test only',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 1,
      requiredDeliveryDate: '2028-12-15',
      idempotencyKey: randomUUID(),
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const projectId = (await created.json()).data.project.id;
  const seeded = await request.post('/api/test/p5c-datasheet-verification/seed', {
    data: { projectId },
  });
  expect(seeded.ok()).toBeTruthy();
  const before = (await (await request.get(`/api/projects/${projectId}/workspace`)).json()).data;
  await page.goto(`/v4/projects/${projectId}/luminaires`);
  await page.getByRole('button', { name: 'A100-UAT', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Selected luminaire inspector' });
  await inspector.getByText('Library actions', { exact: true }).click();
  await inspector.getByRole('button', { name: 'Add to Library', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Create Library Draft from A100-UAT' });
  await expect(review).toBeVisible();
  await review.getByLabel(/Product Type/).fill('Downlight');
  await review.getByLabel(/Product \/ Family Name/).fill('Synthetic Downlight Family');
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/create-library-draft') && response.request().method() === 'POST',
    ),
    review.getByRole('button', { name: 'Create Draft', exact: true }).click(),
  ]);
  expect(response.ok(), await response.text()).toBeTruthy();
  const after = (await (await request.get(`/api/projects/${projectId}/workspace`)).json()).data;
  expect(after.luminaires).toEqual(before.luminaires);
});
