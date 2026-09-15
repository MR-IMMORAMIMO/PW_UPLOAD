import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const root = process.cwd(),
  output = path.join(root, 'output/agreement-recheck-20260912/new-project-electron');
const { disposable } = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
assert.ok(path.basename(disposable).startsWith('sct-agreement-wizard-'));
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: disposable };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
let app;
const result = { disposable, screenshots: [], errors: [] };
const suffix = Date.now();
const maker = 'Friday Maker ' + suffix,
  family = 'Friday Family ' + suffix;
try {
  app = await electron.launch({ args: [disposable], env });
  const page = await app.firstWindow();
  await page.waitForURL(/\/v4\//);
  const origin = new URL(page.url()).origin;
  page.on('pageerror', (e) => result.errors.push(e.message));
  const get = async (u) => (await (await page.request.get(origin + u)).json()).data;
  const post = async (u, data) => {
    const r = await page.request.post(origin + u, { data });
    assert.ok(r.ok(), await r.text());
    return (await r.json()).data;
  };
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
  await page.goto(origin + '/v4/luminaire-library');
  await page.getByRole('button', { name: 'New Library item options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Manufacturer', exact: true }).click();
  const makerDialog = page.getByRole('dialog', { name: 'Add Manufacturer', exact: true });
  await makerDialog.locator('#library-manufacturer-name').fill(maker);
  await capture('40-library-manufacturer');
  await makerDialog.getByRole('button', { name: 'Save Manufacturer', exact: true }).click();
  await expect(makerDialog).toBeHidden();
  await page.getByRole('button', { name: 'New Draft', exact: true }).click();
  const productDialog = page.getByRole('dialog', { name: 'Add Library Product', exact: true });
  await expect(productDialog.locator('#library-product-manufacturer option:checked')).toHaveText(
    maker,
  );
  await productDialog.locator('#library-product-name').fill(family);
  await productDialog.locator('#library-product-type').fill('Downlight');
  await productDialog.locator('#library-product-description').fill('Published family description');
  await productDialog.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(productDialog).toBeHidden();
  const inspector = page.getByRole('complementary', {
    name: 'Selected product inspector',
    exact: true,
  });
  await expect(inspector.getByRole('heading', { name: family, exact: true })).toBeVisible();
  await expect(
    inspector.getByRole('button', { name: 'Add first variant', exact: true }),
  ).toBeVisible();
  await capture('41-library-empty-family');
  await page.reload();
  await expect(
    page.getByRole('table', { name: 'Luminaire Library Products', exact: true }),
  ).toContainText(family);
  await page
    .getByRole('table', { name: 'Luminaire Library Products', exact: true })
    .getByRole('row')
    .filter({ hasText: family })
    .click();
  await inspector.getByRole('button', { name: 'Add first variant', exact: true }).click();
  const variantDialog = page.getByRole('dialog', { name: 'Add Variant Draft', exact: true });
  await expect(variantDialog.locator('#library-variant-manufacturer option:checked')).toHaveText(
    maker,
  );
  await expect(variantDialog.locator('#library-variant-parent option:checked')).toContainText(
    family,
  );
  await variantDialog.locator('#library-variant-variantLabel').fill('Friday variant');
  await variantDialog.locator('#library-variant-orderingCode').fill('FR-' + suffix);
  await variantDialog.locator('#library-variant-wattage').fill('12 W');
  await variantDialog.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(variantDialog).toBeHidden();
  const products = (
    await get('/api/luminaire-library/products?includeEmptyProducts=true&limit=100')
  ).items;
  const product = products.find((p) => p.product.name === family),
    variant = product.variants[0].variant;
  const logical = await post('/api/luminaire-library/assets', {
    productId: product.product.productId,
    variantId: variant.variantId,
    assetType: 'Datasheet',
    label: 'Friday PDF',
    idempotencyKey: randomUUID(),
  });
  const asset = await post('/api/luminaire-library/assets/' + logical.assetId + '/versions', {
    sourceFilePath: path.join(
      root,
      'output/agreement-recheck-20260912/autocad-print/disposable-layout.pdf',
    ),
    expectedLatestSequence: 0,
    idempotencyKey: randomUUID(),
  });
  await page.reload();
  await page
    .getByRole('table', { name: 'Luminaire Library Products', exact: true })
    .getByRole('row')
    .filter({ hasText: family })
    .click();
  await inspector.getByRole('button', { name: 'Publish Version', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Publish Variant Version', exact: true });
  await expect(confirm).toContainText(family);
  await confirm.getByRole('button', { name: 'Publish Version', exact: true }).click();
  await expect(confirm).toBeHidden();
  await app.evaluate(({ shell }) => {
    globalThis.__libraryOpened = [];
    shell.openPath = async (p) => {
      globalThis.__libraryOpened.push(p);
      return '';
    };
  });
  await inspector.getByRole('button', { name: 'Datasheet', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__libraryOpened.length)).toBe(1);
  assert.deepEqual(
    await readFile(await app.evaluate(() => globalThis.__libraryOpened[0])),
    await readFile(
      path.join(root, 'output/agreement-recheck-20260912/autocad-print/disposable-layout.pdf'),
    ),
  );
  await inspector.getByRole('button', { name: 'Open Draft', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit Variant Draft', exact: true });
  await edit.locator('#library-variant-wattage').fill('18 W');
  await edit.getByRole('button', { name: 'Save Draft', exact: true }).click();
  await expect(edit).toBeHidden();
  await inspector.getByRole('button', { name: 'Compare', exact: true }).click();
  const compare = page.getByRole('dialog', { name: 'Compare variant', exact: true });
  await expect(compare).toContainText('12 W');
  await expect(compare).toContainText('18 W');
  await capture('42-library-compare');
  await compare.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: /Active Drafts/ }).click();
  await expect(
    page.getByRole('table', { name: 'Luminaire Library Products', exact: true }),
  ).toContainText(family);
  await page.getByRole('button', { name: 'Clear KPI filter', exact: true }).click();
  const selectedRow = page
    .getByRole('table', { name: 'Luminaire Library Products', exact: true })
    .getByRole('row')
    .filter({ hasText: 'FR-' + suffix });
  await selectedRow.getByRole('checkbox').check();
  await expect(
    page.getByRole('toolbar', { name: 'Selected Library items', exact: true }),
  ).toContainText('1 selected');
  await capture('43-library-selection');
  assert.deepEqual(result.errors, []);
  result.passed = true;
  result.productId = product.product.productId;
  result.variantId = variant.variantId;
  result.assetVersionId = asset.assetVersionId;
} catch (e) {
  result.failure = e.stack;
  if (app) {
    const page = await app.firstWindow();
    result.page = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(output, 'library-failure.png') });
  }
  throw e;
} finally {
  await writeFile(path.join(output, 'library-results.json'), JSON.stringify(result, null, 2));
  if (app) await app.close();
}
