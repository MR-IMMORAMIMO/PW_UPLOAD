/* global document, window */
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createSearchableDocumentPdf,
  createImageOnlyDocumentPdf,
} from '../apps/api/src/infrastructure/document-intelligence/testing/DocumentIntelligenceFixture.ts';

const [executable, output, localAiKit, cpuFallback, offlineFixturePdf] = process.argv.slice(2);
const root = await mkdtemp(path.join(tmpdir(), 'sct-verification-packaged-'));
await mkdir(output, { recursive: true });
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: root };
if (localAiKit) {
  await symlink(
    path.join(localAiKit, 'Local AI Models'),
    path.join(root, 'Local AI Models'),
    'junction',
  );
  await symlink(
    path.join(localAiKit, 'Local AI Runtime'),
    path.join(root, 'Local AI Runtime'),
    'junction',
  );
  if (cpuFallback === 'cpu') env.LOCALAPPDATA = root;
}
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
    brand: 'Acme Lighting',
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
  const batch = await request(
    'POST',
    `/api/projects/${id}/local-intelligence/analyze-datasheets`,
    {},
  );
  const analysis = batch.items.find((item) => item.luminaireId === luminaireId)?.analysis;
  assert.ok(analysis?.documentId, JSON.stringify(batch));
  const preview = await request(
    'GET',
    `/api/documents/${analysis.documentId}/preview?pageNumber=1`,
  );
  assert.ok(preview.width > 0 && preview.height > 0);
  const png = Buffer.from(preview.pngBase64, 'base64');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  await writeFile(path.join(output, 'evidence-page.png'), png);
  await page.goto(`${origin}/v4/projects/${id}/technical-check`);
  await page.locator('button[aria-haspopup="listbox"][aria-label="Result"]').click();
  await page.getByRole('option', { name: 'All', exact: true }).click();
  const powerRow = page.getByRole('button', { name: /^QA-01: \d+ checks$/ });
  for (let index = 0; index < 10 && !(await powerRow.count()); index++)
    await page
      .getByText(/^Showing \d+ to \d+ of \d+ issues$/)
      .locator('..')
      .getByRole('button', { name: 'Next page', exact: true })
      .click();
  await powerRow.getByRole('button', { name: /^Review QA-01: \d+ checks$/ }).click();
  const review = page.getByRole('dialog', { name: 'Technical Verification — QA-01', exact: true });
  await review.getByRole('button', { name: 'System Power', exact: true }).click();
  await review
    .getByRole('navigation', { name: 'Field detail pages' })
    .getByRole('button', { name: 'Page 2 of 4', exact: true })
    .click();
  await review
    .locator('.v4-technical-verification__preview-empty')
    .getByRole('button', { name: 'View Evidence' })
    .click();
  await review.getByAltText('Bounded Datasheet evidence page 1').waitFor();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.screenshot({ path: path.join(output, `verification-${theme}.png`) });
    const icons = await review
      .locator('.v4-technical-verification__row-action svg')
      .evaluateAll((icons) => icons.map((icon) => icon.getBoundingClientRect().width));
    assert.ok(
      icons.every((width) => width >= 10),
      'Action icons must not collapse inside their buttons.',
    );
  }
  if (localAiKit) {
    const before = await request('GET', studioUrl);
    await review.getByRole('button', { name: 'Local AI review', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Local AI review', exact: true });
    const started = Date.now();
    await panel.getByRole('button', { name: 'Scan Datasheet', exact: true }).click();
    const endpoint = `/api/projects/${id}/luminaires/${luminaireId}/local-ai`;
    let result;
    while (Date.now() - started < 250000) {
      result = await request('GET', endpoint);
      if (result?.state !== 'RUNNING' && result) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.equal(result?.state, 'COMPLETED', JSON.stringify(result));
    const actualLuminaire = (await request('GET', `/api/projects/${id}/workspace`)).luminaires.find(
      (row) => row.id === luminaireId,
    );
    evidence.aiSnapshotDifferences = Object.entries(result.projectSnapshot).filter(
      ([field, value]) => String(actualLuminaire[field] ?? '') !== value,
    );
    evidence.aiAssetsAtCompletion = (await request('GET', assetUrl)).map((asset) => ({
      id: asset.id,
      assetType: asset.assetType,
    }));
    assert.ok(
      result.pages[0].findings.some(
        (finding) => finding.field === 'wattage' && finding.value === '15 W',
      ),
    );
    assert.deepEqual((await request('GET', studioUrl)).document, before.document);
    evidence.localAi = {
      seconds: (Date.now() - started) / 1000,
      report: result,
      cpuFallback: cpuFallback === 'cpu',
    };
    await panel.getByAltText('Source Datasheet page 1').waitFor();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.screenshot({ path: path.join(output, `local-ai-${theme}.png`) });
    }
    await panel
      .locator('.v4-floating-workspace__footer')
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await panel.waitFor({ state: 'hidden' });
  }
  if (!localAiKit) {
    assert.equal(
      await review.getByRole('button', { name: 'Local AI review', exact: true }).count(),
      0,
    );
    const beforeReview = await request('GET', studioUrl);
    await review.getByRole('button', { name: 'Review reading', exact: true }).click();
    await review.getByText('Confirm value from Datasheet', { exact: true }).click();
    await review.getByLabel('Reviewed Datasheet value', { exact: true }).fill('15 W');
    await review
      .getByLabel('Review note', { exact: true })
      .fill('Verified directly against the printed system power cell.');
    await review
      .getByRole('checkbox', { name: 'I checked this value against the displayed PDF page.' })
      .check();
    await page.screenshot({ path: path.join(output, 'manual-confirmation.png') });
    await review.getByRole('button', { name: 'Save reviewed reading', exact: true }).click();
    await page.waitForTimeout(1500);
    const afterReview = await request(
      'POST',
      `/api/projects/${id}/local-intelligence/analyze-datasheets`,
      {},
    );
    const confirmed = afterReview.items.find((item) => item.luminaireId === luminaireId)?.analysis;
    assert.ok(
      confirmed.comparisons
        .find((item) => item.fieldKey === 'wattage')
        ?.reviewNotes?.some((note) => note.startsWith('OWNER_CONFIRMED:')),
    );
    assert.deepEqual((await request('GET', studioUrl)).document, beforeReview.document);
    evidence.manualConfirmation = { persisted: true, projectUnchanged: true, analysis: confirmed };
  }
  const imagePdf = path.join(root, 'image-datasheet.pdf');
  await writeFile(imagePdf, createImageOnlyDocumentPdf('PRODUCT TEST'));
  await request('POST', assetUrl, { assetType: 'Datasheet', filePath: imagePdf });
  const imagesUrl = `/api/projects/${id}/luminaires/${luminaireId}/datasheet-images`;
  const choices = await request('GET', `${imagesUrl}?pageNumber=1`);
  assert.ok(choices.images.length);
  await review.getByRole('button', { name: 'Product image from Datasheet', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Product image from Datasheet', exact: true });
  await picker.getByRole('button', { name: 'Select image 1 from page 1' }).click();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.screenshot({ path: path.join(output, `image-picker-${theme}.png`) });
  }
  const [applied] = await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith(imagesUrl) && response.request().method() === 'POST',
    ),
    picker.getByRole('button', { name: 'Use selected image' }).click(),
  ]);
  assert.ok(applied.ok(), await applied.text());
  await picker.waitFor({ state: 'hidden' });
  const versions = await request('GET', assetUrl);
  evidence.imageVersions = versions;
  evidence.preview = { width: preview.width, height: preview.height, bytes: png.length };
  evidence.build = expected;
  if (offlineFixturePdf && !localAiKit) {
    await request('POST', assetUrl, { assetType: 'Datasheet', filePath: offlineFixturePdf });
    const started = Date.now();
    const scanned = await request(
      'POST',
      `/api/projects/${id}/local-intelligence/analyze-datasheets`,
      {},
    );
    const checked = scanned.items.find((item) => item.luminaireId === luminaireId)?.analysis;
    const power = checked?.comparisons.find((item) => item.fieldKey === 'wattage');
    assert.ok(
      power?.reviewNotes?.some((note) => note === 'OCR_SECOND_READING:DISAGREE:134:13.4'),
      JSON.stringify(checked),
    );
    assert.ok(
      !power.reviewNotes.some((note) => note.startsWith('OWNER_CONFIRMED:')),
      'Replacement file must invalidate the previous manual confirmation',
    );
    assert.notEqual(power.verificationResult, 'MATCH');
    assert.ok(power.region && power.region.y > 1500);
    await page.goto(`${origin}/v4/projects/${id}/technical-check`);
    await page.locator('button[aria-haspopup="listbox"][aria-label="Result"]').click();
    await page.getByRole('option', { name: 'All', exact: true }).click();
    const realPower = page.getByRole('button', { name: /^QA-01: \d+ checks$/ });
    for (let index = 0; index < 20 && !(await realPower.count()); index++)
      await page
        .getByText(/^Showing \d+ to \d+ of \d+ issues$/)
        .locator('..')
        .getByRole('button', { name: 'Next page', exact: true })
        .click();
    await realPower.getByRole('button', { name: /^Review QA-01: \d+ checks$/ }).click();
    const realReview = page.getByRole('dialog', {
      name: 'Technical Verification — QA-01',
      exact: true,
    });
    await realReview.getByRole('button', { name: 'System Power', exact: true }).click();
    await realReview
      .locator('.v4-technical-verification__preview-empty')
      .getByRole('button', { name: 'View Evidence' })
      .click();
    await realReview.getByRole('img', { name: 'Highlighted Datasheet evidence region' }).waitFor();
    const previewHeight = await realReview
      .locator('.v4-technical-verification__preview')
      .evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(previewHeight > 100, 'Evidence preview must remain visible');
    await page.screenshot({ path: path.join(output, 'real-offline-ocr-evidence.png') });
    evidence.offlineOcr = {
      seconds: (Date.now() - started) / 1000,
      comparison: power,
      previousConfirmationInvalidated: true,
      previewHeight,
    };
  }
  await page.goto(`${origin}/v4/projects/${id}/luminaires`);
  await page.getByRole('heading', { name: 'Luminaires', exact: true }).waitFor();
  const thumbnail = page.locator('table').getByAltText('QA-01 product');
  await thumbnail.waitFor();
  await thumbnail.evaluate((image) => image.decode());
  assert.ok(await thumbnail.evaluate((image) => image.naturalWidth > 0));
  await page.screenshot({ path: path.join(output, 'luminaires-table.png') });
  evidence.projectThumbnail = true;
  await page.goto(`${origin}/v4/projects/${id}/output-studio`);
  const studioFrame = page.frameLocator('iframe[title="Luminaire Studio 1.4.1"]');
  await studioFrame.locator('.previewpanel iframe').waitFor();
  const geometry = await studioFrame.locator('.previewpanel').evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    top: el.getBoundingClientRect().top,
    windowHeight: window.innerHeight,
  }));
  assert.ok(
    geometry.height > (geometry.windowHeight - geometry.top) * 0.75,
    JSON.stringify(geometry),
  );
  assert.equal(await studioFrame.locator('.topbar').isVisible(), false);
  const controls = studioFrame.locator('.settings');
  const controlGeometry = await controls.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    return {
      height: node.clientHeight,
      total: node.scrollHeight,
      scroll: node.scrollTop,
      bottom: node.getBoundingClientRect().bottom,
      viewport: window.innerHeight,
      hidden: node.querySelectorAll('[hidden]').length,
    };
  });
  assert.ok(
    controlGeometry.scroll > 0 && controlGeometry.total > controlGeometry.height,
    JSON.stringify(controlGeometry),
  );
  assert.ok(
    controlGeometry.bottom <= controlGeometry.viewport + 2,
    JSON.stringify(controlGeometry),
  );
  assert.equal(
    controlGeometry.hidden,
    0,
    'Every Output setting must remain reachable by scrolling',
  );
  evidence.outputControls = controlGeometry;
  await page.screenshot({ path: path.join(output, 'output-fluid.png') });
  evidence.outputPreview = geometry;
  await page.goto(`${origin}/v4/projects/${id}/studio-datasheets`);
  await studioFrame.locator('#dsPreview').waitFor();
  const refs = studioFrame.locator('details[data-ds-detail="references"]');
  const navButtons = studioFrame.locator('nav[aria-label=".ds-tools pages"] button');
  for (let index = 0; index < (await navButtons.count()) && !(await refs.isVisible()); index++)
    await navButtons.nth(index).click();
  if (!(await refs.evaluate((el) => el.open))) await refs.locator('summary').click();
  await refs.locator('[data-ds-action="from-datasheet"][data-slot="0"]').click();
  const referencePicker = studioFrame.getByRole('dialog', {
    name: 'Reference image from Datasheet',
  });
  await referencePicker.getByRole('button', { name: 'Crop PDF page', exact: true }).click();
  await referencePicker.getByLabel('Width %', { exact: true }).fill('50');
  await referencePicker.getByLabel('Height %', { exact: true }).fill('50');
  await page.screenshot({ path: path.join(output, 'reference-image-crop.png') });
  const savedReference = page.waitForResponse(
    (response) => response.url().endsWith(studioUrl) && response.request().method() === 'PUT',
  );
  await referencePicker.getByRole('button', { name: 'Use reference image', exact: true }).click();
  assert.ok((await savedReference).ok());
  const persisted = await request('GET', studioUrl);
  assert.ok(
    persisted.document.luminaires
      .find((row) => row.id === luminaireId)
      .specSheet.refs[0].data.startsWith('data:image/png;base64,'),
  );
  const afterImages = await request('GET', assetUrl);
  assert.deepEqual(
    afterImages,
    versions,
    'Reference images must not replace managed ProductImage versions',
  );
  await page.reload();
  await studioFrame.locator('#dsPreview').waitFor();
  await page.screenshot({ path: path.join(output, 'datasheets-fluid.png') });
  evidence.referenceImage = { saved: true, productImageUnchanged: true };
  // Reproduce the owner's crowded, wrong-identity review in a disposable project.
  const crowded = await request('GET', studioUrl);
  crowded.document.luminaires[0].brand = 'Different Manufacturer';
  crowded.document.luminaires[0].orderCode = 'OTHER-999';
  for (let n = 2; n <= 9; n++)
    crowded.document.luminaires.push({
      id: randomUUID(),
      tag: `QA-${String(n).padStart(2, '0')}`,
      brand: 'Synthetic',
      description: 'Long description for navigator geometry validation',
      power: '12 W',
      quantity: 1,
    });
  await request('PUT', studioUrl, {
    document: crowded.document,
    expectedVersion: crowded.version,
    baseFingerprint: crowded.fingerprint,
    operationId: randomUUID(),
  });
  await request('POST', assetUrl, { assetType: 'Datasheet', filePath: pdf });
  await request('POST', `/api/projects/${id}/local-intelligence/analyze-datasheets`, {});
  await page.goto(`${origin}/v4/projects/${id}/technical-check`);
  await page.getByRole('button', { name: /^Review QA-01: \d+ checks$/ }).click();
  await review.getByRole('heading', { name: 'POSSIBLE WRONG DATASHEET', exact: true }).waitFor();
  const detail = review.getByRole('complementary', { name: 'Selected field detail' });
  evidence.inspectorSizes = [];
  for (const size of [
    [1920, 1080],
    [1280, 800],
  ]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.unmaximize();
      win.setSize(...size);
    }, size);
    await page.waitForTimeout(300);
    await detail.getByRole('button', { name: 'Edit value', exact: true }).click();
    const editor = detail
      .getByRole('region', { name: 'Edit Project field', exact: true })
      .locator('details');
    if (!(await editor.evaluate((node) => node.open))) await editor.locator('summary').click();
    await detail
      .getByRole('button', { name: 'Save Project value', exact: true })
      .scrollIntoViewIfNeeded();
    const geometry = await detail.evaluate((node) => {
      const outer = node.getBoundingClientRect();
      const button = [...node.querySelectorAll('button')]
        .find((b) => b.textContent === 'Save Project value')
        .getBoundingClientRect();
      return {
        top: outer.top,
        bottom: outer.bottom,
        buttonTop: button.top,
        buttonBottom: button.bottom,
        viewport: window.innerHeight,
      };
    });
    assert.ok(
      geometry.buttonTop >= geometry.top &&
        geometry.buttonBottom <= geometry.bottom &&
        geometry.bottom <= geometry.viewport,
      JSON.stringify(geometry),
    );
    const cards = await review
      .locator('.v4-technical-verification__lum-card')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height };
        }),
      );
    assert.ok(
      cards.every(
        (card, index) => card.height >= 78 && (!index || card.top >= cards[index - 1].bottom),
      ),
      JSON.stringify(cards),
    );
    evidence.inspectorSizes.push({ size, geometry, cards });
    await page.screenshot({ path: path.join(output, `inspector-edit-${size[0]}.png`) });
  }
  await detail.getByRole('combobox', { name: /^Project field/ }).selectOption('mounting');
  await detail.getByLabel('Project value', { exact: true }).fill('Recessed - Inspector reviewed');
  const savedField = page.waitForResponse(
    (response) =>
      response.url().endsWith('/technical-field') && response.request().method() === 'PATCH',
  );
  await detail.getByRole('button', { name: 'Save Project value', exact: true }).click();
  assert.ok((await savedField).ok());
  const edited = await request('GET', studioUrl);
  assert.equal(
    edited.document.luminaires.find((item) => item.id === luminaireId).mounting,
    'Recessed - Inspector reviewed',
  );
  evidence.inspectorEditSaved = true;
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
}
