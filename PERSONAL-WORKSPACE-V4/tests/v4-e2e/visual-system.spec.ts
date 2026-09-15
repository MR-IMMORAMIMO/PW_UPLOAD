import { expect, test, type Page, type TestInfo } from '@playwright/test';

type VisualTheme = 'light' | 'dark';
type SidebarMode = 'extended' | 'minimal';

const futureDate = '2028-12-15';

async function openVisualState(
  page: Page,
  path: string,
  options: { theme: VisualTheme; sidebar: SidebarMode; width: 1080 | 1440 },
) {
  await page.setViewportSize({ width: options.width, height: 900 });
  await page.goto('/v4/dashboard');
  await page.evaluate(({ theme, sidebar }) => {
    window.localStorage.setItem('scli.v4.theme', theme);
    window.localStorage.setItem('scli.v4.sidebar.mode', sidebar);
  }, options);
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.v4-shell')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  // Preserve real Phase 3B motion while capturing the settled post-transition state.
  await page.waitForTimeout(260);
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
    animations: 'allow',
  });
}

test('Phase 3C Light/Dark, 1080/1440 and interaction-state visual matrix', async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const runtimeFailures: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeFailures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => runtimeFailures.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (
      response.url().includes('/api/') &&
      ([403, 404, 500] as number[]).includes(response.status())
    ) {
      runtimeFailures.push(
        `${response.status()}: ${response.request().method()} ${response.url()}`,
      );
    }
  });

  // Fresh startup proof: the disposable server's seeded project and workspace
  // come from one SQLite authority and render without a reset or synthetic route.
  const seededProjectsResponse = await request.get('/api/projects');
  expect(seededProjectsResponse.ok()).toBe(true);
  const seededProjects = (await seededProjectsResponse.json()).data as { id: string }[];
  expect(seededProjects.length).toBeGreaterThan(0);
  const seededProjectId = seededProjects[0]!.id;
  expect((await request.get(`/api/projects/${seededProjectId}/workspace`)).ok()).toBe(true);
  await openVisualState(page, `/v4/projects/${seededProjectId}/summary`, {
    theme: 'light',
    sidebar: 'extended',
    width: 1440,
  });
  await expect(page.getByRole('heading', { name: 'Project Overview' })).toBeVisible();

  const create = await request.post('/api/projects', {
    data: {
      projectName: 'Phase 3C Visual Acceptance',
      clientName: 'Disposable Client',
      projectType: 'Lighting Layout',
      description: 'Disposable V4 visual-system acceptance project.',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'Disposable visual validation.',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: futureDate,
      crmReference: `P3C-${Date.now()}`,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(create.ok()).toBe(true);
  const project = (await create.json()).data.project as { id: string };
  const projectRoot = `/v4/projects/${project.id}`;

  await openVisualState(page, '/v4/dashboard', {
    theme: 'light',
    sidebar: 'extended',
    width: 1440,
  });
  await capture(page, testInfo, '01-dashboard-extended-light-1440');

  await openVisualState(page, '/v4/projects', {
    theme: 'dark',
    sidebar: 'minimal',
    width: 1080,
  });
  await capture(page, testInfo, '02-projects-minimal-dark-1080');

  await openVisualState(page, `${projectRoot}/summary`, {
    theme: 'dark',
    sidebar: 'extended',
    width: 1440,
  });
  await page.getByRole('button', { name: 'Work Session' }).click();
  await page.getByRole('button', { name: 'Start Session' }).click();
  await expect(page.getByRole('status', { name: 'Work Session running' })).toBeVisible();
  await capture(page, testInfo, '03-summary-running-timer-dark-1440');

  await openVisualState(page, `${projectRoot}/revisions`, {
    theme: 'light',
    sidebar: 'extended',
    width: 1440,
  });
  await page.getByTestId('v4-generate-output-trigger').click();
  await expect(page.getByRole('menu', { name: 'Generate output' })).toBeVisible();
  await capture(page, testInfo, '04-revisions-inspector-menu-light-1440');

  await openVisualState(page, `${projectRoot}/revisions`, {
    theme: 'dark',
    sidebar: 'minimal',
    width: 1080,
  });
  await capture(page, testInfo, '05-revisions-inspector-dark-1080');

  await openVisualState(page, `${projectRoot}/packages`, {
    theme: 'light',
    sidebar: 'minimal',
    width: 1080,
  });
  await capture(page, testInfo, '06-packages-light-1080');

  await openVisualState(page, `${projectRoot}/actions`, {
    theme: 'dark',
    sidebar: 'extended',
    width: 1440,
  });
  await page.getByRole('button', { name: 'Add Action' }).first().click();
  const actionDrawer = page.getByRole('dialog', { name: 'Add action' });
  await actionDrawer.getByLabel('Title').fill('Visual acceptance action');
  await actionDrawer.getByRole('button', { name: 'Add action' }).click();
  await expect(actionDrawer).toBeHidden();
  await page.getByRole('button', { name: 'Visual acceptance action', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Action details' })).toBeVisible();
  await capture(page, testInfo, '07-actions-inspector-dark-1440');

  await openVisualState(page, `${projectRoot}/meetings`, {
    theme: 'light',
    sidebar: 'minimal',
    width: 1080,
  });
  await page.getByRole('button', { name: 'Add Meeting' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Add Meeting' })).toBeVisible();
  await capture(page, testInfo, '08-meetings-drawer-light-1080');

  await openVisualState(page, `${projectRoot}/scope`, {
    theme: 'dark',
    sidebar: 'extended',
    width: 1440,
  });
  await capture(page, testInfo, '09-scope-dark-1440');

  await openVisualState(page, `${projectRoot}/files`, {
    theme: 'dark',
    sidebar: 'extended',
    width: 1080,
  });
  const filesHeaderGeometry = await page.evaluate(() => {
    const description = document.querySelector<HTMLElement>(
      '.v4-files__page-header .v4-page-header__description',
    )!;
    const actions = document.querySelector<HTMLElement>(
      '.v4-files__page-header .v4-page-header__actions',
    )!;
    const descriptionBox = description.getBoundingClientRect();
    const actionsBox = actions.getBoundingClientRect();
    return {
      descriptionWidth: descriptionBox.width,
      actionsBelowDescription: actionsBox.top >= descriptionBox.bottom - 1,
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  expect(filesHeaderGeometry.descriptionWidth).toBeGreaterThan(320);
  expect(filesHeaderGeometry.actionsBelowDescription).toBe(true);
  expect(filesHeaderGeometry.documentOverflow).toBe(false);
  await capture(page, testInfo, '10-files-dark-1080');

  await openVisualState(page, `${projectRoot}/summary`, {
    theme: 'light',
    sidebar: 'extended',
    width: 1440,
  });
  await page.getByRole('button', { name: 'Edit Project' }).first().click();
  const editWorkspace = page.getByRole('dialog', { name: 'Edit Project' });
  await expect(editWorkspace).toBeVisible();
  await capture(page, testInfo, '11-full-edit-light-1440');

  await editWorkspace.getByRole('button', { name: 'Close' }).click();
  await expect(editWorkspace).toBeHidden();
  await openVisualState(page, `${projectRoot}/summary`, {
    theme: 'dark',
    sidebar: 'minimal',
    width: 1080,
  });
  await page.getByRole('button', { name: 'Edit Project' }).first().click();
  const darkEditWorkspace = page.getByRole('dialog', { name: 'Edit Project' });
  await darkEditWorkspace
    .getByRole('textbox', { name: 'Client', exact: true })
    .fill('Unsaved visual acceptance client');
  await darkEditWorkspace.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Discard changes' })).toBeVisible();
  await capture(page, testInfo, '12-full-edit-confirmation-dark-1080');

  const workspaceResponse = await request.get(`/api/projects/${project.id}/workspace`);
  expect(workspaceResponse.ok()).toBe(true);
  const activity = (await workspaceResponse.json()).data.activity as Array<{
    createdAt: string;
  }>;
  expect(activity.length).toBeGreaterThan(0);
  const activityTimestamp = activity[0]!.createdAt;
  const dubaiLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(activityTimestamp));
  const londonContext = await browser.newContext({ timezoneId: 'Europe/London' });
  try {
    const londonPage = await londonContext.newPage();
    await londonPage.goto(`${new URL(page.url()).origin}${projectRoot}/summary`);
    await expect(londonPage.locator(`time[datetime="${activityTimestamp}"]`)).toHaveText(
      dubaiLabel,
    );
    await capture(londonPage, testInfo, '13-summary-dubai-time-in-london-browser-1440');
  } finally {
    await londonContext.close();
  }

  const stop = await request.post('/api/personal/work-sessions/stop', {
    data: { idempotencyKey: crypto.randomUUID() },
  });
  expect(stop.ok()).toBe(true);
  if (runtimeFailures.length > 0) {
    await testInfo.attach('runtime-failures.json', {
      body: JSON.stringify(runtimeFailures, null, 2),
      contentType: 'application/json',
    });
  }
  expect(runtimeFailures).toEqual([]);
});
