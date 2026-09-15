import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { TEST_FUTURE_REQUIRED_DELIVERY_DATE } from '../test-authority';

const users = {
  salesOne: '11111111-1111-4111-8111-111111111111',
  salesTwo: '22222222-2222-4222-8222-222222222222',
  designerOne: '33333333-3333-4333-8333-333333333333',
  designerTwo: '44444444-4444-4444-8444-444444444444',
  designerThree: '55555555-5555-4555-8555-555555555555',
  manager: '66666666-6666-4666-8666-666666666666',
} as const;

async function reset(request: APIRequestContext) {
  const response = await request.post('/api/test/reset', {
    headers: { 'x-test-reset': 'scli-e2e' },
  });
  expect(response.ok()).toBe(true);
}

async function switchUser(page: Page, id: string) {
  await page.getByLabel('View as').selectOption(id);
  await expect(page.getByLabel('View as')).toHaveValue(id);
}

async function api(
  request: APIRequestContext,
  userId: string,
  method: 'get' | 'post' | 'patch',
  path: string,
  data?: unknown,
) {
  return request[method](path, {
    headers: { 'x-mock-user-id': userId },
    ...(data === undefined ? {} : { data }),
  });
}

async function completeProjectForm(page: Page, name: string, client = 'E2E Client') {
  await page
    .getByRole('button', { name: /Lighting Layout/i })
    .first()
    .click();
  await page.locator('input[name="projectName"]').fill(name);
  await page.locator('input[name="clientName"]').fill(client);
  await page.locator('input[name="siteLocation"]').fill('Dubai, UAE');
  await page.locator('input[name="requiredDeliveryDate"]').fill(TEST_FUTURE_REQUIRED_DELIVERY_DATE);
}

test.beforeEach(async ({ request, page }) => {
  await reset(request);
  await page.goto('/');
  await expect(page.getByText('Development mode')).toBeVisible();
});

test('Sales creates, Manager assigns, Lighting Designer updates, and Sales sees the update', async ({
  page,
}) => {
  await switchUser(page, users.salesOne);
  await page.getByRole('link', { name: 'New Request', exact: true }).click();
  await completeProjectForm(page, 'E2E Lighting Project Alpha');
  await page.getByRole('button', { name: 'CREATE PROJECT' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'E2E Lighting Project Alpha' })).toBeVisible();

  await switchUser(page, users.manager);
  await page.getByRole('button', { name: 'Assign Lighting Designer' }).click();
  await page.getByRole('button', { name: /Lina Mansour/ }).click();
  const reason = page.getByRole('textbox', { name: 'Override reason' });
  if (await reason.isVisible()) await reason.fill('Assigned for lighting project continuity.');
  await page.getByRole('button', { name: 'Confirm assignment' }).click();
  await expect(page.getByText('Lina Mansour', { exact: true }).first()).toBeVisible();

  await switchUser(page, users.designerOne);
  await page.getByRole('button', { name: 'Update project' }).click();
  await page.getByLabel('Progress %').fill('45');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(
    page.getByRole('progressbar', { name: 'Overall delivery progress' }),
  ).toHaveAttribute('aria-valuenow', '45');
  await page.getByRole('button', { name: 'Start work' }).click();
  await expect(page.getByText('Tracking live')).toBeVisible();
  await page.getByRole('button', { name: 'Stop & save' }).click();
  await expect(page.getByText('In Progress', { exact: true }).first()).toBeVisible();
  // The single contextual rail shows project nav in project context, so the
  // designer returns to the global rail before opening Time & Timesheets.
  await page.getByRole('button', { name: /Back to Projects/ }).click();
  await page.getByRole('link', { name: 'Time & Timesheets' }).click();
  await page.getByRole('button', { name: 'Submit to manager' }).click();
  await expect(page.getByText('Submitted', { exact: true }).first()).toBeVisible();

  await switchUser(page, users.manager);
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await page.getByRole('button', { name: /Approved 1/ }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();

  await switchUser(page, users.salesOne);
  await page.goto('/projects');
  await page.getByRole('link', { name: 'E2E Lighting Project Alpha' }).first().click();
  await expect(page.getByRole('heading', { name: 'E2E Lighting Project Alpha' })).toBeVisible();
  await expect(
    page.getByRole('progressbar', { name: 'Overall delivery progress' }),
  ).toHaveAttribute('aria-valuenow', '45');
});

test('Manager creates on behalf of Sales and both identities remain in history', async ({
  page,
}) => {
  await page.getByRole('link', { name: 'New Project' }).click();
  await page.getByRole('combobox', { name: 'Sales Owner' }).selectOption(users.salesTwo);
  await completeProjectForm(page, 'E2E On Behalf Request');
  await page.getByRole('button', { name: 'CREATE PROJECT' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByText(/Created on behalf of Omar Khalid by Daniel Brooks/)).toBeVisible();

  await switchUser(page, users.salesTwo);
  await expect(page.getByRole('heading', { name: 'E2E On Behalf Request' })).toBeVisible();
  await expect(page.locator('dd').filter({ hasText: 'Daniel Brooks' })).toBeVisible();
  await expect(page.locator('dd').filter({ hasText: 'Omar Khalid' })).toBeVisible();
});

test('Manager adds a collaborator who can edit shared lighting content', async ({ page }) => {
  await page.goto('/projects/aaaaaaaa-0000-4000-8000-000000000002');
  await page.getByRole('button', { name: 'Manage project team' }).click();
  await page.getByRole('checkbox', { name: /Noah Ferreira/ }).check();
  const reason = page.getByRole('textbox', { name: 'Override reason' });
  if (await reason.isVisible()) await reason.fill('Keeping the existing primary project lead.');
  await page.getByRole('button', { name: 'Confirm assignment' }).click();
  await expect(page.locator('dd').filter({ hasText: 'Noah Ferreira' })).toBeVisible();

  await switchUser(page, users.designerTwo);
  await expect(page.getByRole('heading', { name: 'Horizon Office Lux Study' })).toBeVisible();
  await page.getByRole('button', { name: 'Update project' }).click();
  await page.getByLabel('Drawing reference').fill('L-202 Rev C');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('dd').filter({ hasText: 'L-202 Rev C' })).toBeVisible();

  await switchUser(page, users.salesTwo);
  await expect(page.getByRole('heading', { name: 'Horizon Office Lux Study' })).toBeVisible();
  await expect(page.locator('dd').filter({ hasText: 'L-202 Rev C' })).toBeVisible();
});

test('Sales cannot open another Sales owner project by direct URL', async ({ page }) => {
  await switchUser(page, users.salesOne);
  await page.goto('/projects/aaaaaaaa-0000-4000-8000-000000000002');
  await expect(page.getByRole('alert')).toContainText('You do not have access to this project');
});

test('Lighting Designer cannot assign or reassign a project', async ({ page, request }) => {
  const response = await api(
    request,
    users.designerOne,
    'post',
    '/api/projects/aaaaaaaa-0000-4000-8000-000000000001/assign',
    { designerId: users.designerThree },
  );
  expect(response.status()).toBe(403);

  await switchUser(page, users.designerOne);
  await page.goto('/unassigned');
  await expect(page.getByText('This area is not available for your role')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Assign GEVI Sharjah Lighting Concept/ }),
  ).toHaveCount(0);
});

test('Manager explicitly overrides an unavailable Lighting Designer warning', async ({ page }) => {
  await page.goto('/projects/aaaaaaaa-0000-4000-8000-000000000001');
  await page.getByRole('button', { name: 'Assign Lighting Designer' }).click();
  await page.getByRole('button', { name: /Sara Al Nuaimi/ }).click();
  await expect(page.getByText('Capacity override required')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Override reason' })
    .fill('Specialist required for the exterior lighting calculations.');
  await page.getByRole('button', { name: 'Confirm assignment' }).click();
  await expect(page.getByText('Sara Al Nuaimi', { exact: true }).first()).toBeVisible();
});

test('rejected board transition rolls optimistic UI back', async ({ page }) => {
  const projectId = 'aaaaaaaa-0000-4000-8000-000000000005';
  await page.route(`**/api/projects/${projectId}/status`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'INVALID_TRANSITION',
          message: 'Simulated server policy rejection.',
          correlationId: 'e2e-rollback',
        },
      }),
    });
  });
  await page.goto('/projects');
  await page.getByLabel('Move Atlas Tender Lighting Package').selectOption('InternalReview');
  await expect(page.getByText(/The board was restored/)).toBeVisible();
  const inProgress = page
    .locator('[aria-label="Project status board"]')
    .locator('section')
    .filter({
      has: page.getByText('In Progress', { exact: true }),
    });
  await expect(
    inProgress.getByRole('link', { name: 'Atlas Tender Lighting Package' }),
  ).toBeVisible();
});

test('concurrent creation keeps project codes unique', async ({ request }) => {
  const responses = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      api(request, users.salesOne, 'post', '/api/projects', {
        projectName: `Concurrent E2E ${index + 1}`,
        clientName: 'Concurrency Client',
        projectType: 'Lighting Layout',
        description: '',
        siteLocation: 'Dubai, UAE',
        designStage: 'Concept',
        lightingScope: 'Concurrency validation for a lighting project.',
        luxRequirements: '',
        drawingReference: '',
        priority: 'Normal',
        complexity: 'Small',
        estimatedHours: 1,
        requiredDeliveryDate: TEST_FUTURE_REQUIRED_DELIVERY_DATE,
        projectFolderUrl: null,
        idempotencyKey: `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      }),
    ),
  );
  expect(responses.every((response) => response.status() === 201)).toBe(true);
  const payloads = await Promise.all(responses.map((response) => response.json()));
  const codes = payloads.map((payload) => payload.data.project.projectCode as string);
  expect(new Set(codes).size).toBe(20);
});
