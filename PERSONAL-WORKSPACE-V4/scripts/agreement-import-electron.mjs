import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd(),
  output = path.join(root, 'output/agreement-recheck-20260912/new-project-electron');
const { disposable } = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
assert.ok(path.basename(disposable).startsWith('sct-agreement-wizard-'));
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: disposable };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
let app;
const result = { disposable, screenshots: [], errors: [] };
const suffix = Date.now(),
  maker = 'Import Maker ' + suffix,
  family = 'Import Family ' + suffix,
  file = path.join(disposable, 'friday-import-' + suffix + '.csv');
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
  const libId = JSON.parse(
    await readFile(path.join(output, 'library-results.json'), 'utf8'),
  ).productId;
  const product = await get('/api/luminaire-library/products/' + libId),
    variant = product.variants[0].variant;
  await writeFile(
    file,
    [
      'Manufacturer,Product Family,Ordering Code,Wattage [W],Lumens [lm],CCT [K],CRI',
      `${product.manufacturer.name},${product.product.name},${variant.orderingCode},18,900,3000,95`,
      `${maker},${family},IMP-${suffix},12,900,3000,90`,
      `${maker},${family},SKIP-${suffix},15,1000,4000,80`,
    ].join('\n'),
  );
  await page.goto(origin + '/v4/imports');
  await page.getByRole('button', { name: 'Destination: Project', exact: true }).click();
  await page.getByRole('option', { name: 'Master Library', exact: true }).click();
  const count = (await get('/api/imports?limit=50')).totalCount;
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page.getByRole('button', { name: 'New Import', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Select import source', exact: true }),
  ).toBeEnabled();
  assert.equal((await get('/api/imports?limit=50')).totalCount, count);
  await capture('44-import-cancel');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, file);
  await page.getByRole('button', { name: 'New Import', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Import rows', exact: true })).toContainText(
    'IMP-' + suffix,
  );
  await page.getByRole('button', { name: 'Reconcile Library', exact: true }).click();
  const group = page.locator('.v4-imports__manufacturer-group').filter({ hasText: maker });
  await group.getByRole('button', { name: 'Create Manufacturer', exact: true }).click();
  await expect(group).toContainText('CREATE');
  const rowsRegion = page.getByRole('region', { name: 'Import rows', exact: true });
  const inspector = page.getByRole('complementary', { name: 'Row Inspector', exact: true });
  const selectRow = async (code) => {
    await rowsRegion.locator('.v4-imports__row').filter({ hasText: code }).click();
    await expect(inspector).toContainText(code);
  };
  const action = async (name) => {
    await inspector.getByRole('button', { name: /^Row action:/ }).click();
    await page.getByRole('option', { name, exact: true }).click();
    await expect(
      inspector.getByRole('button', { name: 'Row action: ' + name, exact: true }),
    ).toBeVisible();
  };
  await selectRow(variant.orderingCode);
  await action('Review Existing Variant');
  await expect(page).toHaveURL(/\/imports/);
  await inspector.getByRole('button', { name: 'View Comparison', exact: true }).click();
  const compare = page.getByRole('dialog', { name: 'Existing and imported values', exact: true });
  await expect(compare).toContainText('Product family');
  await expect(compare).toContainText('95');
  await capture('45-import-comparison');
  await compare.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  await action('Use Existing Variant');
  await selectRow('IMP-' + suffix);
  await action('Create Library Draft');
  await selectRow('SKIP-' + suffix);
  await action('Skip Row');
  await page
    .getByRole('textbox', { name: 'Search import rows', exact: true })
    .fill('SKIP-' + suffix);
  await expect(rowsRegion.locator('.v4-imports__row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(rowsRegion.locator('.v4-imports__row')).toHaveCount(3);
  await capture('46-import-decisions');
  const history = await get('/api/imports?limit=50'),
    current = history.items.find((s) => s.sourceFileName === path.basename(file));
  result.importSessionId = current.importSessionId;
  await page.reload();
  await page
    .locator('.v4-imports__recent-card')
    .filter({ hasText: path.basename(file) })
    .click();
  await selectRow('IMP-' + suffix);
  await expect(
    inspector.getByRole('button', { name: 'Row action: Create Library Draft', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Smart Import sections', exact: true })
    .getByRole('button', { name: 'Mapping Rules', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Source table mapping', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Ready to Apply/ }).click();
  await expect(page.getByRole('region', { name: 'Apply plan details', exact: true })).toContainText(
    'LIBRARY CREATE DRAFT',
  );
  await page.getByRole('button', { name: 'Apply 3 rows', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Apply 3 rows', exact: true });
  await confirmation.getByRole('button', { name: 'Apply 3 rows', exact: true }).click();
  await expect(confirmation).toBeHidden();
  await expect
    .poll(async () => {
      const s = await get('/api/imports/' + current.importSessionId);
      return s.sessionStatus;
    })
    .toBe('COMPLETED');
  await capture('47-import-applied');
  const importedRows = (await get('/api/imports/' + current.importSessionId + '/rows?limit=50'))
    .items;
  assert.equal(importedRows.filter((r) => r.resultIdentity?.outcome === 'DRAFT_CREATED').length, 1);
  const created = importedRows.find(
    (r) => r.resultIdentity?.outcome === 'DRAFT_CREATED',
  ).resultIdentity;
  const draft = await get('/api/luminaire-library/products/' + created.productId);
  assert.equal(draft.variants[0].latestVersion, null);
  result.created = created;
  await page
    .getByRole('navigation', { name: 'Smart Import sections', exact: true })
    .getByRole('button', { name: 'Data Sources', exact: true })
    .click();
  const sources = page.getByRole('dialog', { name: 'Data Sources', exact: true });
  await expect(sources).toContainText(path.basename(file));
  await sources
    .getByRole('button', { name: new RegExp(path.basename(file).replaceAll('.', '\\.')) })
    .click();
  await expect(
    page.getByRole('region', { name: 'Imported source preview', exact: true }),
  ).toBeVisible();
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (e) {
  result.failure = e.stack;
  if (app) {
    const page = await app.firstWindow();
    result.page = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(output, 'import-failure.png') });
  }
  throw e;
} finally {
  await writeFile(path.join(output, 'import-results.json'), JSON.stringify(result, null, 2));
  if (app) await app.close();
}
