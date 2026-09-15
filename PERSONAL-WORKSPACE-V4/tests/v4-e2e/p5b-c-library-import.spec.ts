import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { writeFileSync } from 'node:fs';

type ImportSession = {
  importSessionId: string;
  sessionRevision: number;
  previewFingerprint: string;
  destinationFingerprint: string;
  applyPlanFingerprint: string | null;
};

type ImportRow = {
  importRowId: string;
  sourceRowNumber: number;
  rowVersion: number;
  rowStatus: string;
  reconciliation: {
    schemaVersion: 2;
    manufacturer: { manufacturerGroupId: string; name: string; state: string };
    product: {
      productGroupId: string;
      family: string;
      productType: { state: string; values: string[] };
    };
    variant: {
      orderingCode: string;
      exactMatch: { technicalDifferences: unknown[] } | null;
      possibleMatches: unknown[];
    };
    allowedActions: string[];
    warnings: string[];
  };
};

type GeometryEvidence = {
  name: string;
  viewportWidth: number;
  viewportHeight: number;
  documentScrollWidth: number;
  documentScrollHeight: number;
  bodyScrollHeight: number;
};

async function capture(page: Page, testInfo: TestInfo, name: string, evidence: GeometryEvidence[]) {
  await page.waitForTimeout(260);
  const geometry = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
  }));
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentScrollHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.bodyScrollHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  evidence.push({ name, ...geometry });
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
}

async function createManufacturer(request: APIRequestContext, name: string) {
  const response = await request.post('/api/luminaire-library/manufacturers', {
    data: { name, idempotencyKey: `p5bc-maker-${name.toLowerCase()}` },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as { manufacturerId: string; rowVersion: number };
}

async function createProduct(
  request: APIRequestContext,
  manufacturerId: string,
  name: string,
  productType = 'Downlight',
) {
  const response = await request.post('/api/luminaire-library/products', {
    data: {
      manufacturerId,
      name,
      productType,
      description: `${name} disposable P5B-C family.`,
      idempotencyKey: `p5bc-product-${manufacturerId}-${name.toLowerCase()}`,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as { productId: string; rowVersion: number };
}

async function createVariant(
  request: APIRequestContext,
  productId: string,
  orderingCode: string,
  variantLabel: string,
) {
  const response = await request.post(`/api/luminaire-library/products/${productId}/variants`, {
    data: {
      variantLabel,
      orderingCode,
      wattage: '10 W',
      lumens: '1000 lm',
      lightColor: '3000 K',
      cri: 'CRI 90',
      beamAngle: '24°',
      ipRating: 'IP20',
      mounting: 'Recessed',
      cutout: 'Ø100 mm',
      driver: 'Remote',
      control: 'DALI',
      emergency: 'No',
      dimensions: '120 × 100 mm',
      bodyColorFinish: 'White',
      idempotencyKey: `p5bc-variant-${productId}-${orderingCode || variantLabel}`,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as { variantId: string; rowVersion: number };
}

async function session(request: APIRequestContext, id: string): Promise<ImportSession> {
  const response = await request.get(`/api/imports/${id}`);
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).data as ImportSession;
}

async function rows(request: APIRequestContext, id: string): Promise<ImportRow[]> {
  const response = await request.get(`/api/imports/${id}/rows?limit=100`);
  expect(response.ok(), await response.text()).toBe(true);
  return ((await response.json()).data as { items: ImportRow[] }).items;
}

async function reopen(page: Page, sourceName: string) {
  await page.getByRole('button', { name: 'Import History', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Import History' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Import History' })
    .getByRole('button', { name: new RegExp(sourceName.replace('.', '\\.')) })
    .click();
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /4 Reconcile/ })
    .click();
  await expect(page.getByRole('button', { name: /^002 NEW-A / })).toBeVisible();
}

test('P5B-C A-N Library Draft reconciliation, Apply, idempotency, and 25-view evidence', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(10_000);
  const runtimeFailures: string[] = [];
  const evidence: GeometryEvidence[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeFailures.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => runtimeFailures.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && [403, 404, 500].includes(response.status()))
      runtimeFailures.push(
        `${response.status()}: ${response.request().method()} ${response.url()}`,
      );
  });

  const projectsResponse = await request.get('/api/projects');
  expect(projectsResponse.ok()).toBe(true);
  const project = ((await projectsResponse.json()).data as Array<{ id: string }>)[0]!;
  const projectBeforeResponse = await request.get(`/api/projects/${project.id}/workspace`);
  const projectBefore = (await projectBeforeResponse.json()).data as { luminaires: unknown[] };

  const acme = await createManufacturer(request, 'Acme P5BC');
  const arc = await createProduct(request, acme.manufacturerId, 'Arc P5BC');
  const exact = await createVariant(request, arc.productId, 'EXACT-P5BC-01', 'Exact P5BC');
  await createVariant(request, arc.productId, '', 'Possible Twin P5BC');
  const old = await createManufacturer(request, 'OldCo P5BC');
  const oldProduct = await createProduct(request, old.manufacturerId, 'Archive P5BC');
  const oldVariant = await createVariant(
    request,
    oldProduct.productId,
    'OLD-P5BC-01',
    'Archived P5BC',
  );
  for (const [url, rowVersion] of [
    [`/api/luminaire-library/variants/${oldVariant.variantId}/archive`, oldVariant.rowVersion],
    [`/api/luminaire-library/products/${oldProduct.productId}/archive`, oldProduct.rowVersion],
    [`/api/luminaire-library/manufacturers/${old.manufacturerId}/archive`, old.rowVersion],
  ] as const) {
    const archived = await request.post(url, {
      data: { expectedRowVersion: rowVersion, idempotencyKey: `p5bc-archive-${url}` },
    });
    expect(archived.ok(), await archived.text()).toBe(true);
  }
  const versionsBefore = await request.get(
    `/api/luminaire-library/variants/${exact.variantId}/versions`,
  );
  expect(((await versionsBefore.json()).data as unknown[]).length).toBe(0);

  const createdResponse = await request.post('/api/imports', {
    data: { destinationMode: 'MASTER_LIBRARY', projectId: null },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()).data as { importSessionId: string };
  const header = [
    'Manufacturer',
    'Product Family',
    'Product Type',
    'Description',
    'Variant Label',
    'Ordering Code',
    'Wattage [W]',
    'Lumens [lm]',
    'CCT [K]',
    'CRI',
    'Beam Angle',
    'Control',
    'Tag',
    'Project Category',
    'Location',
    'Unit',
    'Quantity',
    'Notes',
    'Description Override',
    'Product Image',
    'Datasheet',
    'IES',
    'LDT',
  ].join(',');
  const fixtureRows = [
    'Acme P5BC,Arc P5BC,Downlight,Arc family,New A,NEW-A,12,900,3000,90,36°,DALI,,,,,,,,,,,',
    'Acme P5BC,Beam P5BC,Spotlight,Beam family,Beam B1,BEAM-B1,14,1100,3000,90,24°,DALI,,,,,,,,,,,',
    'Acme P5BC,Beam P5BC,Spotlight,Beam family,Beam B2,BEAM-B2,16,1300,4000,90,36°,DALI,,,,,,,,,,,',
    'NewCo P5BC,Family One,Linear,Family one,New C1,NEW-C1,8,600,3000,90,Wide,DALI,,,,,,,,,,,',
    'NewCo P5BC,Family Two,Linear,Family two,New C2,NEW-C2,10,750,3000,90,Wide,DALI,,,,,,,,,,,',
    'Acme P5BC,Arc P5BC,Downlight,Arc family,Exact D,EXACT-P5BC-01,10,1000,3000,90,24°,DALI,,,,,,,,,,,',
    'Acme P5BC,Wrong Family,Downlight,Wrong family,Exact E,EXACT-P5BC-01,10,1000,3000,90,24°,DALI,,,,,,,,,,,',
    'Acme P5BC,Arc P5BC,Downlight,Arc family,Exact F,EXACT-P5BC-01,12,1200,4000,90,36°,DALI,,,,,,,,,,,',
    'Acme P5BC,Arc P5BC,Downlight,Arc family,No Code G,,15,1400,3000,90,60°,DALI,,,,,,,,,,,',
    'Acme P5BC,Arc P5BC,Downlight,Arc family,Possible Twin P5BC,,10,1000,3000,90,24°,DALI,,,,,,,,,,,',
    'Acme P5BC,Conflict P5BC,Linear,Conflict family,Conflict I1,CONFLICT-I1,20,1800,3000,90,Wide,DALI,,,,,,,,,,,',
    'Acme P5BC,Conflict P5BC,Track,Conflict family,Conflict I2,CONFLICT-I2,22,1900,3000,90,Wide,DALI,,,,,,,,,,,',
    'OldCo P5BC,Archive P5BC,Downlight,Archived family,Archived J,OLD-P5BC-01,10,1000,3000,90,24°,DALI,,,,,,,,,,,',
    'Acme P5BC,Excluded P5BC,Downlight,Excluded family,Excluded K,EXCLUDED-K,9,700,3000,90,24°,DALI,K-01,Emergency,Lobby,EA,3,Project note,Project override,source-image-reference,source-datasheet-reference,source-ies-reference,source-ldt-reference',
    'Acme P5BC,Arc P5BC,Downlight,Arc family,Skip L,SKIP-L,11,850,3000,90,24°,DALI,,,,,,,,,,,',
    'Acme P5BC,Mixed P5BC,Downlight,Mixed family,Ready M,READY-M,13,980,3000,90,24°,DALI,,,,,,,,,,,',
    'Acme P5BC,Mixed P5BC,Downlight,Mixed family,,BLOCKED-M,,,,,,,,,,,,,,,,,',
    'ReplayCo P5BC,Replay P5BC,Linear,Replay family,Replay N,REPLAY-N,18,1600,4000,90,Wide,DALI,,,,,,,,,,,',
  ];
  const uploadResponse = await request.post(`/api/imports/${created.importSessionId}/source`, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-import-file-name': encodeURIComponent('p5b-c-library-a-n.csv'),
    },
    data: Buffer.from([header, ...fixtureRows].join('\n')),
  });
  expect(uploadResponse.ok(), await uploadResponse.text()).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/v4/imports');
  await page.evaluate(() => {
    localStorage.setItem('scli.v4.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await reopen(page, 'p5b-c-library-a-n.csv');
  await expect(page.getByRole('region', { name: 'Import status summary' })).toContainText(
    '18 rows',
  );
  await expect(page.getByRole('button', { name: /^002 NEW-A / })).toContainText(
    'READY TO RECONCILE',
  );
  await expect(page.getByRole('button', { name: 'Reconcile Library' })).toBeEnabled();
  await expect(
    page.getByRole('button', { name: 'Row action: Owner decision required' }),
  ).toBeDisabled();
  await expect(
    page.getByText('Reconcile Library before choosing an action.').first(),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /5 Apply/ })
    .click();
  await expect(page.getByRole('button', { name: 'Apply 0 rows' })).toBeDisabled();
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /4 Reconcile/ })
    .click();
  await page.getByRole('checkbox', { name: 'Select import row 2' }).check();
  await expect(page.getByLabel('Bulk row action')).toBeDisabled();
  await expect(page.getByText('Reconcile Library before choosing an action.').last()).toBeVisible();
  await page.getByRole('button', { name: 'Reconcile Library' }).click();
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /3 Map/ })
    .click();
  await expect(page.getByRole('region', { name: 'Library group review' })).toBeVisible();
  let current = await session(request, created.importSessionId);
  await capture(page, testInfo, '01-manufacturer-groups', evidence);
  await expect(page.getByText('Acme P5BC', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, '02-existing-manufacturer-group', evidence);
  await expect(page.getByText('NewCo P5BC', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, '03-new-manufacturer-group', evidence);
  await expect(page.getByText('Product Families').first()).toBeVisible();
  await capture(page, testInfo, '04-product-groups', evidence);
  await capture(page, testInfo, '05-existing-product-new-variants', evidence);
  await capture(page, testInfo, '06-new-product-multiple-variants', evidence);
  await expect(page.locator('[aria-label="Resolve Product Type"]')).toBeVisible();
  await capture(page, testInfo, '07-product-type-conflict', evidence);

  const rowButton = (sourceRow: number) =>
    page.getByRole('button', { name: new RegExp(`^${String(sourceRow).padStart(3, '0')} `) });
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /4 Reconcile/ })
    .click();
  expect(
    await page.locator('.v4-imports__rows-scroll').evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(80);
  await rowButton(7).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Row Inspector' })).toContainText(
    'EXACT ACTIVE',
  );
  await capture(page, testInfo, '08-exact-ordering-code-match', evidence);
  await rowButton(8).click();
  await expect(page.getByRole('complementary', { name: 'Row Inspector' })).toContainText(
    'PRODUCT FAMILY CONFLICT',
  );
  await capture(page, testInfo, '09-product-family-conflict', evidence);
  await rowButton(9).click();
  await expect(page.getByRole('complementary', { name: 'Row Inspector' })).toContainText(
    'TECHNICAL DIFFERENCE',
  );
  await capture(page, testInfo, '10-technical-difference', evidence);
  await rowButton(11).click();
  await expect(page.getByRole('complementary', { name: 'Row Inspector' })).toContainText(
    'advisory possible matches',
  );
  await capture(page, testInfo, '11-possible-duplicate', evidence);
  await rowButton(10).click();
  await capture(page, testInfo, '12-empty-ordering-code-draft', evidence);
  await rowButton(15).click();
  await expect(page.getByRole('complementary', { name: 'Row Inspector' })).toContainText(
    'DESCRIPTION OVERRIDE is Project-only',
  );
  await capture(page, testInfo, '13-project-only-field-exclusion', evidence);
  await expect(page.getByRole('complementary', { name: 'Row Inspector' })).toContainText(
    'Publish: NO',
  );
  await capture(page, testInfo, '14-row-inspector-publish-no', evidence);

  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /3 Map/ })
    .click();
  while ((await page.getByRole('button', { name: 'Create Manufacturer' }).count()) > 0) {
    await page.getByRole('button', { name: 'Create Manufacturer' }).first().click();
    await page.waitForTimeout(200);
  }
  current = await session(request, created.importSessionId);
  let currentRows = await rows(request, created.importSessionId);
  const conflictRow = currentRows.find((row) => row.sourceRowNumber === 12)!;
  const groupDecision = await request.patch(
    `/api/imports/${created.importSessionId}/library-groups`,
    {
      data: {
        kind: 'PRODUCT',
        expectedSessionRevision: current.sessionRevision,
        productGroupId: conflictRow.reconciliation.product.productGroupId,
        decision: { productType: 'Linear' },
      },
    },
  );
  expect(groupDecision.ok(), await groupDecision.text()).toBe(true);
  current = await session(request, created.importSessionId);
  currentRows = await rows(request, created.importSessionId);
  for (const row of currentRows) {
    let action: string | null = null;
    if (row.sourceRowNumber === 16) action = 'SKIP';
    else if ([7, 9].includes(row.sourceRowNumber)) action = 'LIBRARY_USE_EXISTING';
    else if (row.sourceRowNumber === 8) action = 'LIBRARY_REVIEW_EXISTING';
    else if (row.reconciliation.allowedActions.includes('LIBRARY_CREATE_DRAFT'))
      action = 'LIBRARY_CREATE_DRAFT';
    if (!action) continue;
    const response = await request.patch(
      `/api/imports/${created.importSessionId}/rows/${row.importRowId}/action`,
      {
        data: {
          expectedSessionRevision: current.sessionRevision,
          expectedRowVersion: row.rowVersion,
          action:
            action === 'SKIP'
              ? { type: action, reason: 'Explicit Owner UAT skip.' }
              : { type: action },
        },
      },
    );
    expect(response.ok(), `${row.sourceRowNumber}: ${await response.text()}`).toBe(true);
    current = await session(request, created.importSessionId);
  }

  await page.reload();
  await reopen(page, 'p5b-c-library-a-n.csv');
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /5 Apply/ })
    .click();
  await expect(page.getByText(/Drafts will be created · Apply ready · Publish: NO/)).toBeVisible();
  await capture(page, testInfo, '15-apply-summary', evidence);
  await expect(page.getByText(/Published Versions: 0/)).toBeVisible();
  await capture(page, testInfo, '16-published-versions-created-zero', evidence);
  await page.getByRole('button', { name: 'Apply Ready Rows Only' }).click();
  const confirm = page.getByRole('dialog', { name: /Apply \d+ rows/ });
  await expect(confirm).toContainText('Published Versions created: 0');
  await capture(page, testInfo, '17-ready-only-partial-confirmation', evidence);
  await confirm.getByRole('button', { name: 'Cancel' }).click();

  current = await session(request, created.importSessionId);
  const applyInput = {
    expectedSessionRevision: current.sessionRevision,
    previewFingerprint: current.previewFingerprint,
    destinationFingerprint: current.destinationFingerprint,
    applyPlanFingerprint: current.applyPlanFingerprint,
    idempotencyKey: 'p5bc-a-n-ready-only-apply',
    mode: 'READY_ONLY',
    confirmPartial: true,
  };
  const applyResponse = await request.post(`/api/imports/${created.importSessionId}/apply`, {
    data: applyInput,
  });
  expect(applyResponse.ok(), await applyResponse.text()).toBe(true);
  const applied = (await applyResponse.json()).data as {
    applyAttemptId: string;
    counts: { publishedVersionsCreated: number; variantDraftsCreated: number };
  };
  expect(applied.counts.publishedVersionsCreated).toBe(0);
  expect(applied.counts.variantDraftsCreated).toBeGreaterThan(0);
  const replayResponse = await request.post(`/api/imports/${created.importSessionId}/apply`, {
    data: applyInput,
  });
  expect(replayResponse.ok(), await replayResponse.text()).toBe(true);
  expect(((await replayResponse.json()).data as { applyAttemptId: string }).applyAttemptId).toBe(
    applied.applyAttemptId,
  );

  await page.reload();
  await reopen(page, 'p5b-c-library-a-n.csv');
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /5 Apply/ })
    .click();
  await expect(page.getByRole('region', { name: 'Apply terminal result' })).toContainText(
    'Published Versions created: 0',
  );
  await capture(page, testInfo, '18-apply-success', evidence);
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /4 Reconcile/ })
    .click();
  await rowButton(7).focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /5 Apply/ })
    .click();
  await expect(page.getByRole('region', { name: 'Apply terminal result' })).toContainText(
    'Existing Variants used:',
  );
  await capture(page, testInfo, '19-used-existing-result', evidence);
  await page.getByRole('button', { name: 'Import History', exact: true }).first().click();
  await capture(page, testInfo, '20-history', evidence);
  await page.keyboard.press('Escape');
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /4 Reconcile/ })
    .click();
  await rowButton(2).focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: /5 Apply/ })
    .click();
  await expect(page.getByRole('button', { name: 'Open Created Draft' })).toBeVisible();
  await capture(page, testInfo, '21-open-created-draft', evidence);
  await page.getByRole('button', { name: 'Open Created Draft' }).click();
  await expect(page).toHaveURL(/luminaire-library\?productId=[\da-f-]+&variantId=[\da-f-]+/);
  await expect(
    page.getByRole('complementary', { name: 'Selected product inspector' }),
  ).toContainText('NEW-A');
  await page.goto('/v4/imports');
  await reopen(page, 'p5b-c-library-a-n.csv');
  await page.evaluate(() => {
    localStorage.setItem('scli.v4.theme', 'light');
    document.documentElement.dataset.theme = 'light';
  });
  await capture(page, testInfo, '22-light-1440', evidence);
  await page.evaluate(() => {
    localStorage.setItem('scli.v4.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await capture(page, testInfo, '23-dark-1440', evidence);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await capture(page, testInfo, '24-1920x1080', evidence);
  await page.setViewportSize({ width: 1080, height: 900 });
  await capture(page, testInfo, '25-compact-width', evidence);
  expect(
    await page.locator('.v4-imports__rows-scroll').evaluate((element) => element.clientHeight),
  ).toBeGreaterThan(80);

  const versionsAfter = await request.get(
    `/api/luminaire-library/variants/${exact.variantId}/versions`,
  );
  expect(((await versionsAfter.json()).data as unknown[]).length).toBe(0);
  const projectAfterResponse = await request.get(`/api/projects/${project.id}/workspace`);
  const projectAfter = (await projectAfterResponse.json()).data as { luminaires: unknown[] };
  expect(projectAfter.luminaires).toHaveLength(projectBefore.luminaires.length);
  expect(evidence).toHaveLength(25);
  expect(runtimeFailures).toEqual([]);
  writeFileSync(
    testInfo.outputPath('p5b-c-geometry-evidence.json'),
    JSON.stringify(evidence, null, 2),
  );
});
