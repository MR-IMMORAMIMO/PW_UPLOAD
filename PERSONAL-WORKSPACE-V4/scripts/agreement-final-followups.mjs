import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const output = path.resolve('output/agreement-recheck-20260912/new-project-electron');
const { disposable } = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
assert.ok(path.basename(disposable).startsWith('sct-agreement-wizard-'));
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: disposable };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
const result = { checks: [], errors: [], themes: [] };
let app, page, origin;
const launch = async () => {
  app = await electron.launch({ args: [disposable], env });
  page = await app.firstWindow();
  await page.waitForURL(/\/v4\//);
  origin = new URL(page.url()).origin;
  page.on('pageerror', (e) => result.errors.push(e.message));
};
const get = async (url) => {
  const r = await page.request.get(origin + url);
  assert.ok(r.ok(), await r.text());
  return (await r.json()).data;
};
try {
  await launch();
  const project = (await get('/api/projects')).find(
    (p) => p.projectName === 'Friday Wizard Verification',
  );
  assert.ok(project);
  await page.goto(origin + '/v4/projects');
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  const projectRow = page.getByRole('row').filter({ hasText: 'Friday Wizard Verification' });
  if (await projectRow.getByRole('button', { name: 'Favorite project', exact: true }).count())
    await projectRow.getByRole('button', { name: 'Favorite project', exact: true }).click();
  await expect(
    projectRow.getByRole('button', { name: 'Remove favorite', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await app.close();
  await launch();
  await page.goto(origin + '/v4/projects');
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await expect(
    page
      .getByRole('row')
      .filter({ hasText: 'Friday Wizard Verification' })
      .getByRole('button', { name: 'Remove favorite', exact: true }),
  ).toBeVisible();
  result.checks.push('Projects favorite and Board preference survive a real process restart');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  let wizard = page.getByRole('dialog', { name: 'New Project', exact: true });
  const draftName = 'Friday restart draft ' + Date.now();
  await wizard.getByRole('textbox', { name: 'projectName', exact: true }).fill(draftName);
  for (const kind of ['client', 'sales contact', 'manager']) {
    await wizard.getByRole('button', { name: 'Add ' + kind, exact: true }).click();
    const dialog = page.getByRole('dialog', {
      name: kind === 'sales contact' ? 'Add Sales contact' : 'Add ' + kind,
      exact: true,
    });
    const name = 'Friday ' + kind + ' ' + Date.now();
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Save and select', exact: true }).click();
    await expect(dialog).toBeHidden();
    await wizard.getByRole('button', { name: 'Add ' + kind, exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await dialog.getByRole('button', { name: 'Save and select', exact: true }).click();
    await expect(dialog).toContainText('already exists');
    await dialog.getByRole('button', { name: 'Use existing', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(wizard.getByRole('textbox', { name: 'projectName', exact: true })).toHaveValue(
      draftName,
    );
  }
  await wizard
    .locator('header')
    .getByRole('button', { name: 'Save as Draft', exact: true })
    .click();
  await expect
    .poll(async () => (await get('/api/personal/project-wizard-draft')).fields.projectName)
    .toBe(draftName);
  await app.close();
  await launch();
  await page.goto(origin + '/v4/projects');
  await page.getByRole('button', { name: 'New Project', exact: true }).click();
  wizard = page.getByRole('dialog', { name: 'New Project', exact: true });
  await wizard.getByRole('button', { name: 'Resume saved draft', exact: true }).click();
  await expect(wizard.getByRole('textbox', { name: 'projectName', exact: true })).toHaveValue(
    draftName,
  );
  await wizard
    .locator('header')
    .getByRole('button', { name: 'Save as Draft', exact: true })
    .click();
  result.checks.push(
    'Client/Sales/Manager create with optional email, duplicate reuse, preserved wizard text and draft survive process restart',
  );
  await page.goto(origin + '/v4/projects/' + project.id + '/lighting-systems');
  let state = await get('/api/projects/' + project.id + '/luminaire-studio');
  const accessory = state.document.accessories.find((a) => a.ref === 'ACC-FRIDAY');
  assert.ok(accessory);
  accessory.rate = 127.35;
  const saved = await page.request.put(
    origin + '/api/projects/' + project.id + '/luminaire-studio',
    {
      data: {
        expectedVersion: state.version,
        baseFingerprint: state.fingerprint,
        operationId: randomUUID(),
        document: state.document,
      },
    },
  );
  assert.ok(saved.ok(), await saved.text());
  await page.goto(origin + '/v4/projects/' + project.id + '/system-accessories');
  const studio = page.frameLocator('iframe[title="Luminaire Studio 1.4.1"]');
  await studio.getByRole('button', { name: 'ACC-FRIDAY', exact: true }).click();
  await studio
    .getByRole('complementary', { name: 'Accessory details', exact: true })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const form = studio.locator('#recordForm');
  await expect(form.locator('[name="rate"]')).toHaveCount(0);
  await form.locator('[name="description"]').fill('Edited while preserving historic rate');
  await form.getByRole('button', { name: 'Save accessory', exact: true }).click();
  const row = studio.locator('tr[data-studio-record="' + accessory.id + '"]');
  await row.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await form.getByRole('button', { name: 'Save accessory', exact: true }).click();
  await studio
    .getByRole('row')
    .filter({ hasText: 'ACC-FRIDAY-1' })
    .getByRole('button', { name: 'Move up', exact: true })
    .click();
  await studio
    .locator('body')
    .evaluate(async (body) => body.ownerDocument.defaultView.studioFlush());
  state = await get('/api/projects/' + project.id + '/luminaire-studio');
  assert.equal(state.document.accessories.find((a) => a.id === accessory.id).rate, 127.35);
  assert.equal(state.document.accessories.find((a) => a.ref === 'ACC-FRIDAY-1').rate, 127.35);
  result.checks.push(
    'Historic accessory rate retained through hidden editor, duplicate, reorder and persisted save',
  );
  const routes = [
    'dashboard',
    'projects',
    'luminaire-library',
    'imports',
    'reports',
    'settings',
    ...[
      'summary',
      'workflow-timeline',
      'actions',
      'meetings',
      'scope',
      'comments',
      'contacts',
      'luminaires',
      'datasheets-images',
      'technical-check',
      'lighting-systems',
      'system-accessories',
      'output-studio',
      'studio-datasheets',
      'revisions',
      'packages',
      'files',
    ].map((r) => 'projects/' + project.id + '/' + r),
  ];
  for (const theme of ['Light', 'Dark', 'System']) {
    await page.goto(origin + '/v4/settings');
    await page.getByRole('button', { name: theme, exact: true }).click();
    for (const route of routes) {
      await page.goto(origin + '/v4/' + route);
      await expect(page.getByRole('complementary', { name: /workspace sidebar/ })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(page.locator('body')).not.toContainText('Something went wrong');
      const colours = await page.locator('html').evaluate((el) => ({
        surface: getComputedStyle(el).getPropertyValue('--v4-surface'),
        text: getComputedStyle(el).getPropertyValue('--v4-text-primary'),
      }));
      result.themes.push({ theme, route, ...colours });
    }
    await page.screenshot({ path: path.join(output, '59-final-' + theme.toLowerCase() + '.png') });
  }
  await page.goto(origin + '/v4/settings');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.failure = error.stack;
  if (page) {
    result.page = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(output, 'followups-failure.png') });
  }
  throw error;
} finally {
  await writeFile(path.join(output, 'followups-results.json'), JSON.stringify(result, null, 2));
  if (app) await app.close();
}
