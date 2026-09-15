import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const output = path.join(process.cwd(), 'output/agreement-recheck-20260912/new-project-electron');
const { disposable } = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
assert.ok(path.basename(disposable).startsWith('sct-agreement-wizard-'));
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: disposable };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
let app;
const result = { disposable, screenshots: [], errors: [] };
const suffix = Date.now(),
  category = 'Friday Settings Category ' + suffix,
  sales = 'Friday Sales ' + suffix;
try {
  app = await electron.launch({ args: [disposable], env });
  const page = await app.firstWindow();
  await page.waitForURL(/\/v4\//);
  const origin = new URL(page.url()).origin;
  page.on('pageerror', (e) => result.errors.push(e.message));
  const get = async (u) => (await (await page.request.get(origin + u)).json()).data;
  const capture = async (n) => {
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      );
    });
    await page.screenshot({ path: path.join(output, n + '.png') });
    result.screenshots.push(n + '.png');
  };
  await page.goto(origin + '/v4/settings');
  await expect(page.getByRole('button', { name: 'Save Changes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Backup', exact: true })).toHaveCount(1);
  const saved = await get('/api/personal/settings');
  await page
    .getByRole('textbox', { name: 'Company Name', exact: true })
    .fill('Friday Settings Verification');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage Folder Profiles', exact: true }).click();
  const profiles = page.getByRole('dialog', { name: 'Folder Profiles', exact: true });
  await profiles.getByRole('button', { name: 'Preview Full Lighting Design', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview — Full Lighting Design', exact: true });
  await expect(preview.locator('.v4-settings__preview-tree svg')).not.toHaveCount(0);
  await capture('50-settings-folder-preview');
  await preview.getByRole('button', { name: 'Back to profiles', exact: true }).click();
  await profiles.getByRole('button', { name: 'Create Profile', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Create Folder Profile', exact: true });
  await create.getByLabel('Profile name', { exact: true }).fill('Friday Folder ' + suffix);
  await create.getByRole('button', { name: 'Add child to Project', exact: true }).click();
  await create.getByRole('button', { name: 'Add output default', exact: true }).click();
  await expect(create.getByRole('textbox', { name: 'Output type', exact: true })).toBeVisible();
  await create.getByRole('textbox', { name: 'Output type', exact: true }).fill('schedulePdf');
  await create
    .getByRole('textbox', { name: 'Destination path', exact: true })
    .fill('Project/New folder');
  await capture('51-settings-folder-editor');
  await create.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect(create).toBeHidden();
  await expect(page.getByRole('textbox', { name: 'Company Name', exact: true })).toHaveValue(
    'Friday Settings Verification',
  );
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Company Name', exact: true })).toHaveValue(
    'Friday Settings Verification',
  );
  await page.getByRole('button', { name: 'Manage Action Categories', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Action Categories', exact: true })
    .getByRole('button', { name: 'Add Category', exact: true })
    .click();
  const cat = page.getByRole('dialog', { name: 'Add Action Category', exact: true });
  await cat.getByLabel('Label', { exact: true }).fill(category);
  await cat.getByRole('button', { name: 'Save Category', exact: true }).click();
  await expect(cat).toBeHidden();
  await page.getByRole('button', { name: 'Manage Sales Directory', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Sales Directory', exact: true })
    .getByRole('button', { name: 'Add Sales Contact', exact: true })
    .click();
  const salesDialog = page.getByRole('dialog', { name: 'Add Sales Contact', exact: true });
  await salesDialog.getByLabel('Name', { exact: true }).fill(sales);
  await expect(
    salesDialog.getByRole('textbox', { name: 'Email (optional)', exact: true }),
  ).toHaveValue('');
  await capture('52-settings-sales-editor');
  await salesDialog.getByRole('button', { name: 'Save Sales Contact', exact: true }).click();
  await expect(salesDialog).toBeHidden();
  const projects = await get('/api/projects');
  const project = projects.find((p) => p.projectName === 'Friday Wizard Verification');
  await page.goto(origin + '/v4/projects/' + project.id + '/actions');
  await page.getByRole('button', { name: 'Add Action', exact: true }).click();
  const action = page.getByRole('dialog', { name: 'Add Action', exact: true });
  await action.getByRole('button', { name: 'Category', exact: true }).click();
  await expect(page.getByRole('option', { name: category, exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await action.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await page.goto(origin + '/v4/settings');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await capture('53-settings-dark');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Manage', exact: true }).click();
  const integrations = page.getByRole('dialog', { name: 'Desktop integrations', exact: true });
  await capture('54-settings-integrations-dark');
  const box = await integrations.boundingBox();
  assert.ok(box.height < 750);
  await integrations.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await capture('55-settings-light');
  await page.getByRole('textbox', { name: 'Company Name', exact: true }).fill(saved.companyName);
  await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
  await expect(page.getByText('All changes saved', { exact: true })).toBeVisible();
  assert.deepEqual(result.errors, []);
  result.passed = true;
  result.category = category;
  result.sales = sales;
} catch (e) {
  result.failure = e.stack;
  if (app) {
    const page = await app.firstWindow();
    result.page = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(output, 'settings-failure.png') });
  }
  throw e;
} finally {
  await writeFile(path.join(output, 'settings-results.json'), JSON.stringify(result, null, 2));
  if (app) await app.close();
}
