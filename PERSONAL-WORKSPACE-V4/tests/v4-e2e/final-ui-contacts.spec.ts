import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('final Contacts stays UUID-scoped through selection, filtering and reload', async ({
  page,
  request,
}) => {
  const ids: string[] = [];
  for (const projectName of ['Final UI Contacts A', 'Final UI Contacts B']) {
    const response = await request.post('/api/projects', {
      data: {
        projectName,
        clientName: 'Disposable UI Client',
        projectType: 'Lighting Layout',
        siteLocation: 'Dubai',
        designStage: 'Concept',
        lightingScope: 'Disposable UI test',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 8,
        requiredDeliveryDate: '2027-12-01',
        createFolders: false,
        idempotencyKey: randomUUID(),
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    ids.push((await response.json()).data.project.id);
  }
  for (const [index, name] of ['Contact Alpha', 'Contact Beta'].entries()) {
    const response = await request.post(`/api/projects/${ids[index]}/contacts`, {
      data: {
        name,
        company: 'Disposable Company',
        role: index ? 'Sales' : 'Client',
        email: `contact${index}@example.test`,
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await page.goto(`/v4/projects/${ids[0]}/contacts`);
  await expect(page.getByRole('complementary')).toHaveAccessibleName('Project workspace sidebar');
  const sizes: Array<{ width: number; height: number }> = [];
  for (const [width, height] of [
    [1366, 768],
    [1440, 900],
    [1672, 941],
    [1920, 1080],
    [2560, 1440],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toHaveCSS(
      'font-size',
      '20px',
    );
    const dimensions = await page.locator('.final-contacts-list').boundingBox();
    expect(dimensions).not.toBeNull();
    sizes.push({ width: dimensions!.width, height: dimensions!.height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    // The later approved layout is fluid 75/25, replacing the original fixed inspector.
    const inspector = await page.locator('.final-contacts-details').boundingBox();
    expect(inspector).not.toBeNull();
    expect(inspector!.width / (dimensions!.width + inspector!.width)).toBeCloseTo(0.25, 2);
    await expect(page.getByRole('button', { name: 'Add Contact', exact: true })).toBeVisible();
  }
  expect(sizes[4]!.width).toBeGreaterThan(sizes[3]!.width);
  expect(sizes[4]!.height).toBeGreaterThan(sizes[3]!.height);
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.getByRole('button', { name: 'Contact Alpha', exact: true }).click();
  await expect(page.getByTestId('v4-project-contacts')).not.toHaveAttribute(
    'data-selected-contact',
    '',
  );
  // Friday: View selects Cards/List/Table; editing belongs to the selected contact inspector.
  await page
    .getByRole('region', { name: 'Contact details', exact: true })
    .getByRole('button', { name: 'Edit contact', exact: true })
    .click();
  const contactEditor = page.getByRole('dialog', { name: 'Edit Contact', exact: true });
  await expect(contactEditor).toBeVisible();
  await contactEditor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(contactEditor).toBeHidden();
  await page.getByLabel('Search contacts', { exact: true }).fill('absent');
  await expect(page.getByText('No contacts match this search or filter.')).toBeVisible();
  await page.getByLabel('Search contacts', { exact: true }).fill('');
  await page.getByLabel('Filter contacts by role').selectOption('Client');
  await expect(page.getByRole('button', { name: 'Contact Alpha', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Contact Alpha', exact: true })).toBeVisible();
  await expect(page.getByTestId('v4-project-contacts')).toHaveAttribute(
    'data-selected-contact',
    '',
  );
  await page.goto(`/v4/projects/${ids[1]}/contacts`);
  await expect(page.getByRole('button', { name: 'Contact Beta', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Contact Alpha', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Contact', exact: true })).toBeEnabled();
  await page.getByTitle('Collapse sidebar', { exact: true }).click();
  await expect(page.getByRole('complementary')).toHaveCSS('width', '68px');
  await page.getByTitle('Coordination', { exact: true }).press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTitle('Coordination', { exact: true })).toBeFocused();
  await page.getByTitle('Expand sidebar', { exact: true }).click();
  await page.getByRole('button', { name: 'Back to Projects', exact: true }).click();
  await expect(page).toHaveURL(/\/v4\/projects$/);
  await expect(page.getByRole('complementary')).toHaveAccessibleName('Global workspace sidebar');
  await expect(page.getByRole('button', { name: 'Reports', exact: true })).toBeEnabled();
});
