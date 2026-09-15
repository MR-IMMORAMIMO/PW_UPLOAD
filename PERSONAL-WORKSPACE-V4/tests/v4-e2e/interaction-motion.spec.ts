import { expect, test } from '@playwright/test';

const futureDate = '2028-12-15';

function cssTimeMilliseconds(value: string) {
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/.exec(value.trim());
  if (!match) throw new Error(`Invalid computed CSS time: ${value}`);
  const numeric = Number(match[1]);
  return match[2] === 's' ? numeric * 1_000 : numeric;
}

async function motionTokens(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      fast: style.getPropertyValue('--v4-duration-fast').trim(),
      standard: style.getPropertyValue('--v4-duration-standard').trim(),
      workspace: style.getPropertyValue('--v4-duration-workspace').trim(),
      enter: style.getPropertyValue('--v4-ease-enter').trim(),
      exit: style.getPropertyValue('--v4-ease-exit').trim(),
      translateSmall: style.getPropertyValue('--v4-translate-sm').trim(),
      translateMedium: style.getPropertyValue('--v4-translate-md').trim(),
      scale: style.getPropertyValue('--v4-scale-enter').trim(),
    };
  });
}

test('V4 shared modal, drawer, inspector, popover, dirty, and reduced-motion acceptance', async ({
  page,
  request,
}, testInfo) => {
  const create = await request.post('/api/projects', {
    data: {
      projectName: 'Phase 3B Motion Acceptance',
      clientName: 'Disposable Client',
      projectType: 'Lighting Layout',
      description: 'Disposable V4 shared interaction acceptance project.',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'Disposable interaction validation.',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: futureDate,
      crmReference: `P3B-${Date.now()}`,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(create.ok()).toBe(true);
  const project = (await create.json()).data.project as { id: string };
  const projectRoot = `/v4/projects/${project.id}`;

  await page.goto(`${projectRoot}/summary`);
  const editTrigger = page.getByRole('button', { name: 'Edit Project', exact: true });
  await editTrigger.click();
  const workspace = page.getByRole('dialog', { name: 'Edit Project' });
  await expect(workspace).toBeVisible();
  await workspace
    .getByRole('textbox', { name: 'Client', exact: true })
    .fill('Dirty disposable client');
  const discard = page.getByRole('alertdialog', { name: 'Discard changes' });
  await page
    .locator('[aria-label="Project workspace sidebar"]')
    .getByRole('button', { name: 'Workflow Timeline', includeHidden: true })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(discard).toBeVisible();
  await expect(page).toHaveURL(`${projectRoot}/summary`);
  await discard.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(discard).toBeHidden();
  await expect(workspace).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(discard).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(discard).toBeHidden();
  await expect(workspace).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Discard' }).click();
  await expect(workspace).toBeHidden();
  await expect(editTrigger).toBeFocused();

  const statusTrigger = page.locator('.v4-project-status-control__trigger');
  await statusTrigger.click();
  await expect(page.getByRole('menu', { name: 'Change Project status' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Change Project status' })).toBeHidden();
  await statusTrigger.click();
  await page.mouse.click(4, 4);
  await expect(page.getByRole('menu', { name: 'Change Project status' })).toBeHidden();

  await page.goto(`${projectRoot}/actions`);
  await page.getByRole('button', { name: 'Add Action' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add action' });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel('Title').fill('Motion acceptance action');
  await drawer.getByRole('button', { name: 'Add action' }).click();
  await expect(drawer).toBeHidden();

  await page.goto(`${projectRoot}/workflow-timeline`);
  const inspector = page.getByRole('region', { name: 'Event details', exact: true });
  await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: 'View details', exact: true }).click();
  const detailDrawer = page.getByRole('dialog', { name: 'Event details', exact: true });
  await expect(detailDrawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detailDrawer).toBeHidden();
  await expect(inspector.getByRole('button', { name: 'View details', exact: true })).toBeFocused();

  await page.goto(`${projectRoot}/revisions`);
  await page.getByTestId('v4-generate-output-trigger').click();
  await expect(page.getByRole('menu', { name: 'Generate output' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Generate output' })).toBeHidden();

  const standardTokens = await motionTokens(page);
  expect(cssTimeMilliseconds(standardTokens.fast)).toBe(140);
  expect(cssTimeMilliseconds(standardTokens.standard)).toBe(180);
  expect(cssTimeMilliseconds(standardTokens.workspace)).toBe(210);
  expect(standardTokens.translateSmall).toBe('4px');
  expect(standardTokens.translateMedium).toBe('8px');
  expect(Number(standardTokens.scale)).toBe(0.985);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${projectRoot}/summary`);
  await page.getByRole('button', { name: 'Edit Project' }).first().click();
  const reducedWorkspace = page.getByRole('dialog', { name: 'Edit Project' });
  await expect(reducedWorkspace).toBeVisible();
  await reducedWorkspace.getByRole('button', { name: 'Close' }).click();
  await expect(reducedWorkspace).toBeHidden();

  await page.goto(`${projectRoot}/actions`);
  await page.getByRole('button', { name: 'Add Action' }).first().click();
  const reducedDrawer = page.getByRole('dialog', { name: 'Add action' });
  await expect(reducedDrawer).toBeVisible();
  await reducedDrawer.getByRole('button', { name: 'Close' }).click();
  await expect(reducedDrawer).toBeHidden();

  await page.goto(`${projectRoot}/revisions`);
  await page.getByTestId('v4-generate-output-trigger').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-v4-presence="exiting"]')).toHaveCount(0);
  const reducedTokens = await motionTokens(page);
  const normalizedReducedDurations = {
    fast: cssTimeMilliseconds(reducedTokens.fast),
    standard: cssTimeMilliseconds(reducedTokens.standard),
    workspace: cssTimeMilliseconds(reducedTokens.workspace),
  };
  expect(normalizedReducedDurations.fast).toBe(0);
  expect(normalizedReducedDurations.standard).toBe(0);
  expect(normalizedReducedDurations.workspace).toBe(0);
  expect(reducedTokens.translateSmall).toBe('0px');
  expect(reducedTokens.translateMedium).toBe('0px');
  expect(Number(reducedTokens.scale)).toBe(1);

  await testInfo.attach('v4-motion-tokens.json', {
    body: Buffer.from(
      JSON.stringify({ standardTokens, reducedTokens, normalizedReducedDurations }, null, 2),
    ),
    contentType: 'application/json',
  });
  await expect(page.locator('[data-v4-presence="exiting"]')).toHaveCount(0);
});
