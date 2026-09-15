import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSearchableDocumentPdf } from '../apps/api/src/infrastructure/document-intelligence/testing/DocumentIntelligenceFixture.ts';

const [executable, output] = process.argv.slice(2);
const root = await mkdtemp(path.join(tmpdir(), 'sct-verification-packaged-'));
await mkdir(output, { recursive: true });
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: root };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const evidence = { root, executable };
try {
  app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${path.join(root, 'profile')}`],
    env,
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForURL(/\/v4\//);
  const origin = new URL(page.url()).origin;
  const request = async (method, url, body) => {
    const response = await page.request.fetch(`${origin}${url}`, {
      method,
      ...(body ? { data: body } : {}),
      timeout: 120000,
    });
    assert.ok(response.ok(), await response.text());
    return (await response.json()).data;
  };
  const expected = JSON.parse(await readFile('apps/web-v4/dist/build-info.json', 'utf8'));
  const buildResponse = await page.request.get(`${origin}/v4/build-info.json`);
  assert.equal(buildResponse.status(), 200);
  assert.deepEqual(await buildResponse.json(), expected);
  const created = await request('POST', '/api/projects', {
    projectName: 'Verification Acceptance',
    clientName: 'Synthetic',
    projectType: 'Lighting Design',
    description: 'Isolated packaged validation',
    siteLocation: 'Test',
    designStage: 'DetailedDesign',
    lightingScope: 'Test',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 1,
    requiredDeliveryDate: '2028-12-15',
    idempotencyKey: randomUUID(),
  });
  const id = created.project.id;
  const studioUrl = `/api/projects/${id}/luminaire-studio`;
  const state = await request('GET', studioUrl);
  state.document.luminaires.push({
    id: randomUUID(),
    tag: 'QA-01',
    manufacturer: 'Acme Lighting',
    model: 'Audit Downlight',
    description: 'Reusable audit downlight',
    category: 'Downlight',
    orderCode: 'QA100',
    power: '12 W',
    quantity: 1,
  });
  const saved = await request('PUT', studioUrl, {
    document: state.document,
    expectedVersion: state.version,
    baseFingerprint: state.fingerprint,
    operationId: randomUUID(),
  });
  const luminaireId = saved.document.luminaires[0].id;
  const assetUrl = `/api/projects/${id}/luminaires/${luminaireId}/asset-versions`;
  const pdf = path.join(root, 'datasheet.pdf');
  await writeFile(
    pdf,
    createSearchableDocumentPdf([
      'Product Datasheet',
      'Manufacturer: Acme Lighting',
      'Ordering Code: QA100',
      'System Power: 15 W',
      'Luminous Flux: 1200 lm',
      'CCT: 3000 K',
    ]),
  );
  await request('POST', assetUrl, { assetType: 'Datasheet', filePath: pdf });
  const imagePath = path.join(root, 'product.png');
  await writeFile(
    imagePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBz8AAAAASUVORK5CYII=',
      'base64',
    ),
  );
  await request('POST', assetUrl, { assetType: 'ProductImage', filePath: imagePath });
  const before = await request('GET', `/api/projects/${id}/workspace`);
  await page.goto(`${origin}/v4/luminaire-library`);
  await page.getByRole('heading', { name: 'Luminaire Library', exact: true }).waitFor();
  await page.goto(`${origin}/v4/projects/${id}/luminaires`);
  await page.getByRole('button', { name: 'QA-01', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Selected luminaire inspector' });
  await inspector.getByText('Library actions', { exact: true }).click();
  await inspector.getByRole('button', { name: 'Add to Library', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create Library Draft from QA-01' });
  await dialog.getByLabel(/Product Type/).fill('Downlight');
  await dialog.getByLabel(/Product \/ Family Name/).fill('Audit Project to General Library');
  await dialog.getByLabel(/Variant \/ Configuration/).fill('12 W / 3000 K');
  await page.screenshot({ path: path.join(output, 'create-library-draft.png') });
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/create-library-draft') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Create Draft', exact: true }).click();
  const response = await responsePromise;
  assert.ok(response.ok(), await response.text());
  const promoted = (await response.json()).data;
  assert.equal(promoted.assets.length, 2, 'Both ProductImage and Datasheet must be copied');
  assert.equal(promoted.sourceProjectId, id);
  assert.equal(promoted.sourceLuminaireId, luminaireId);
  assert.deepEqual(
    (await request('GET', `/api/projects/${id}/workspace`)).luminaires,
    before.luminaires,
    'Promotion must not change Project rows',
  );
  await page.waitForURL(/luminaire-library/);
  await page
    .getByRole('table', { name: 'Luminaire Library Products' })
    .getByRole('cell', { name: 'Audit Project to General Library', exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole('cell', { name: 'Audit Project to General Library', exact: true })
    .first()
    .waitFor();
  await page.screenshot({ path: path.join(output, 'general-library-reloaded.png') });
  evidence.promotion = {
    sourceUnchanged: true,
    assetsCopied: promoted.assets.length,
    productId: promoted.product.productId,
    variantId: promoted.variant.variantId,
    reloaded: true,
  };
  await app.close();
  app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${path.join(root, 'profile')}`],
    env,
    timeout: 60000,
  });
  const reopened = await app.firstWindow();
  await reopened.waitForURL(/\/v4\//);
  const reopenedOrigin = new URL(reopened.url()).origin;
  await reopened.goto(`${reopenedOrigin}/v4/luminaire-library`);
  await reopened
    .getByRole('table', { name: 'Luminaire Library Products' })
    .getByRole('cell', { name: 'Audit Project to General Library', exact: true })
    .waitFor();
  evidence.promotion.restarted = true;
  const routeErrors = [];
  reopened.on('pageerror', (error) => routeErrors.push(String(error)));
  reopened.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 500)
      routeErrors.push(`${response.status()} ${response.url()}`);
  });
  const routes = [
    '/dashboard',
    '/projects',
    '/luminaire-library',
    '/imports',
    '/documents',
    '/settings',
    '/new',
    ...[
      'summary',
      'workflow-timeline',
      'scope',
      'actions',
      'meetings',
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
      'intelligence',
    ].map((route) => `/projects/${id}/${route}`),
  ];
  evidence.routes = [];
  for (const route of routes) {
    const response = await reopened.goto(`${reopenedOrigin}/v4${route}`);
    assert.ok(response.ok(), route);
    await reopened.waitForLoadState('networkidle');
    const text = await reopened.locator('body').innerText();
    assert.ok(!/Something went wrong|Unable to load this page|Page not found/i.test(text), route);
    const headings = await reopened.getByRole('heading').allTextContents();
    assert.ok(
      headings.length > 0 || (await reopened.locator('iframe').count()),
      `No page content: ${route}`,
    );
    evidence.routes.push({ route, headings, status: response.status() });
  }
  assert.deepEqual(routeErrors, []);
  evidence.routeErrors = routeErrors;
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  await writeFile(path.join(output, 'library-audit.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
