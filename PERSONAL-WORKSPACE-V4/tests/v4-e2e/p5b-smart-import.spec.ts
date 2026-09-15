import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSmartImportUatFixtures } from '../../apps/api/src/scripts/create-smart-import-uat-fixtures';

const fixtureRoots: string[] = [];
test.afterEach(() => {
  while (fixtureRoots.length) rmSync(fixtureRoots.pop()!, { recursive: true, force: true });
});

type GeometryEvidence = {
  name: string;
  viewportWidth: number;
  documentScrollWidth: number;
  viewportHeight: number;
  documentScrollHeight: number;
  bodyScrollHeight: number;
  rows: { clientHeight: number; scrollHeight: number } | null;
  inspector: { clientHeight: number; scrollHeight: number } | null;
};

async function capture(page: Page, testInfo: TestInfo, name: string, evidence: GeometryEvidence[]) {
  await page.waitForTimeout(260);
  const geometry = await page.evaluate(() => {
    const rows = document.querySelector<HTMLElement>('.v4-imports__rows-scroll');
    const inspector = document.querySelector<HTMLElement>('.v4-imports__inspector-scroll');
    return {
      viewportWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportHeight: window.innerHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      bodyScrollHeight: document.body.scrollHeight,
      rows: rows ? { clientHeight: rows.clientHeight, scrollHeight: rows.scrollHeight } : null,
      inspector: inspector
        ? { clientHeight: inspector.clientHeight, scrollHeight: inspector.scrollHeight }
        : null,
    };
  });
  evidence.push({ name, ...geometry });
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.documentScrollHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  expect(geometry.bodyScrollHeight).toBeLessThanOrEqual(geometry.viewportHeight);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
}

async function createSession(
  request: APIRequestContext,
  destinationMode: 'PROJECT' | 'MASTER_LIBRARY',
  projectId: string | null,
) {
  const response = await request.post('/api/imports', { data: { destinationMode, projectId } });
  expect(response.status()).toBe(201);
  return (await response.json()).data as { importSessionId: string };
}

async function upload(
  request: APIRequestContext,
  sessionId: string,
  fileName: string,
  body: Buffer,
) {
  const response = await request.post(`/api/imports/${sessionId}/source`, {
    headers: {
      'content-type': 'application/octet-stream',
      'x-import-file-name': encodeURIComponent(fileName),
    },
    data: body,
  });
  if (!response.ok())
    throw new Error(`Import upload failed ${response.status()}: ${await response.text()}`);
  return (await response.json()).data as { importSessionId: string };
}

async function openWorkflowStep(
  page: Page,
  label: 'Upload' | 'Inspect' | 'Map' | 'Reconcile' | 'Apply',
) {
  await page
    .getByRole('navigation', { name: 'Import workflow' })
    .getByRole('button', { name: new RegExp(label) })
    .click();
}

test('P5B-A persistent Smart Import inspection and visual acceptance', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const runtimeFailures: string[] = [];
  const geometryEvidence: GeometryEvidence[] = [];
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

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/v4/dashboard');
  await page.evaluate(() => {
    window.localStorage.setItem('scli.v4.theme', 'dark');
    window.localStorage.setItem('scli.v4.sidebar.mode', 'extended');
  });
  await page.goto('/v4/imports');
  await expect(page.getByRole('heading', { name: 'Smart Import Center' })).toBeVisible();
  await expect(page.getByText(/Choose a bounded CSV/)).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await capture(page, testInfo, '01-empty-dark-1440x900', geometryEvidence);

  await page.evaluate(() => {
    window.localStorage.setItem('scli.v4.theme', 'light');
    document.documentElement.dataset.theme = 'light';
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await capture(page, testInfo, '02-empty-light-1440x900', geometryEvidence);

  const projectsResponse = await request.get('/api/projects');
  expect(projectsResponse.ok()).toBe(true);
  const project = ((await projectsResponse.json()).data as Array<{ id: string }>)[0]!;
  await expect(page.getByRole('button', { name: 'Select Source' })).toBeEnabled();
  await page.getByRole('button', { name: 'Select Source' }).click();
  const extraRows = Array.from(
    { length: 60 },
    (_, index) =>
      `DL${String(index + 4).padStart(2, '0')};ERCO;ABC-${String(index + 4).padStart(2, '0')};9.5;720;3000`,
  );
  await page.getByLabel('Upload import source').setInputFiles({
    name: 'dialux-owner-uat.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      [
        'TAGText;ManufNameText;ArticleNumberText;ConnectedLoadText;LuminaireLuminousFluxText;CCTText',
        'Type / Tag;Manufacturer;Article Number;Connected Load [W];Luminaire Luminous Flux [lm];CCT [K]',
        'DL01;ERCO;ABC-01;4,4;242;3000',
        'DL02;ERCO;ABC-02;12.5;950;4000',
        'DL03;ERCO;ABC-03;unsafe;unknown;warm',
        ...extraRows,
      ].join('\n'),
    ),
  });
  await expect(page.getByText(/DIALUX NATIVE CSV/)).toBeVisible();
  await page.evaluate(() => {
    window.localStorage.setItem('scli.v4.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await capture(page, testInfo, '03-dialux-populated-dark-1440x900', geometryEvidence);
  await page.setViewportSize({ width: 1672, height: 941 });
  await capture(page, testInfo, '03a-dialux-populated-dark-golden-1672x941', geometryEvidence);
  await page.setViewportSize({ width: 1440, height: 900 });
  const populatedRowsGeometry = await page
    .locator('.v4-imports__rows-scroll')
    .evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
  expect(populatedRowsGeometry.scrollHeight).toBeGreaterThan(populatedRowsGeometry.clientHeight);
  await capture(page, testInfo, '04-independent-status-filters-counts', geometryEvidence);

  await page.getByRole('button', { name: /^Status:/ }).click();
  await page.getByRole('option', { name: /^Ready ·/ }).click();
  await expect(page.getByRole('button', { name: /^Status: Ready ·/ })).toBeVisible();
  await capture(page, testInfo, '05-selected-ready-filter', geometryEvidence);

  await page.getByRole('button', { name: /^Status:/ }).click();
  await page.getByRole('option', { name: /^Needs Review ·/ }).click();
  await expect(page.getByRole('button', { name: /^Status: Needs Review ·/ })).toBeVisible();
  await capture(page, testInfo, '06-selected-needs-review-filter', geometryEvidence);

  await page.getByRole('button', { name: /^Status:/ }).click();
  await page.getByRole('option', { name: /^All ·/ }).click();
  await expect(page.getByRole('complementary', { name: 'Row Inspector' })).toContainText('Source');
  await page.getByRole('button', { name: /DL03/ }).click();
  await expect(page.getByRole('complementary', { name: 'Row Inspector' })).toContainText(
    'BLOCKING',
  );
  await capture(page, testInfo, '07-row-selected-inspector', geometryEvidence);
  await page.locator('.v4-imports__inspector-scroll').evaluate((element) => {
    element.scrollTop = Math.min(180, element.scrollHeight - element.clientHeight);
  });
  await expect
    .poll(() =>
      page.locator('.v4-imports__inspector-scroll').evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(0);
  await capture(page, testInfo, '08-long-inspector-internal-scrollbar', geometryEvidence);

  await openWorkflowStep(page, 'Map');
  const mappingTrigger = page.getByRole('button', { name: /^Map / }).first();
  await mappingTrigger.click();
  const mappingMenu = page.getByRole('listbox', { name: /options$/ }).first();
  await expect(mappingMenu).toBeVisible();
  const mappingGeometry = await mappingMenu.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    bottom: element.getBoundingClientRect().bottom,
  }));
  expect(mappingGeometry.scrollHeight).toBeGreaterThan(mappingGeometry.clientHeight);
  expect(mappingGeometry.bottom).toBeLessThanOrEqual(900);
  await capture(page, testInfo, '09-mapping-dropdown-bounded-scroll', geometryEvidence);
  await page.keyboard.press('Escape');
  await expect(mappingMenu).not.toBeVisible();
  await expect(mappingTrigger).toBeFocused();

  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'p5b-e2e-fixtures-'));
  fixtureRoots.push(fixtureRoot);
  const fixturePaths = await createSmartImportUatFixtures(fixtureRoot);
  const xlsx = readFileSync(fixturePaths[2]!);
  const xlsxSession = await createSession(request, 'MASTER_LIBRARY', null);
  await upload(request, xlsxSession.importSessionId, 'manufacturer-multi-sheet.xlsx', xlsx);

  const conflictSession = await createSession(request, 'MASTER_LIBRARY', null);
  await upload(
    request,
    conflictSession.importSessionId,
    'mapping-conflict.csv',
    Buffer.from('Manufacturer,Brand,Product Family\nERCO,ERCO,Lightscan'),
  );

  await page.getByRole('button', { name: 'Import History', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Import History' })).toBeVisible();
  await page
    .getByRole('dialog', { name: 'Import History' })
    .getByRole('button', { name: /manufacturer-multi-sheet\.xlsx/ })
    .click();
  await expect(page.getByRole('button', { name: /SPY-01/ })).toBeVisible();
  await openWorkflowStep(page, 'Map');
  const worksheetTrigger = page.getByRole('button', { name: /^Worksheet:/ });
  await expect(worksheetTrigger).toBeVisible();
  await worksheetTrigger.click();
  const worksheetMenu = page.getByRole('listbox', { name: 'Worksheet options' });
  await expect(worksheetMenu.getByRole('option', { name: /Hidden options/ })).toBeVisible();
  await capture(page, testInfo, '10-xlsx-worksheet-controls', geometryEvidence);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Import History', exact: true }).first().click();
  await page
    .getByRole('dialog', { name: 'Import History' })
    .getByRole('button', { name: /mapping-conflict\.csv/ })
    .click();
  await openWorkflowStep(page, 'Inspect');
  await expect(
    page.locator('section[aria-live="polite"]').getByText('2 mapping decisions', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Import History', exact: true }).first().click();
  await page
    .getByRole('dialog', { name: 'Import History' })
    .getByRole('button', { name: /dialux-owner-uat\.csv/ })
    .click();
  await openWorkflowStep(page, 'Reconcile');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await capture(page, testInfo, '11-populated-1920x1080', geometryEvidence);
  await page.setViewportSize({ width: 1080, height: 900 });
  await capture(page, testInfo, '12-compact-1080x900', geometryEvidence);
  const compactRegions = await page.evaluate(() => {
    const rows = document.querySelector<HTMLElement>('.v4-imports__rows-scroll')!;
    const inspector = document.querySelector<HTMLElement>('.v4-imports__inspector-scroll')!;
    return {
      rowsClientHeight: rows.clientHeight,
      rowsScrollHeight: rows.scrollHeight,
      inspectorClientHeight: inspector.clientHeight,
      inspectorScrollHeight: inspector.scrollHeight,
    };
  });
  expect(compactRegions.rowsScrollHeight).toBeGreaterThan(compactRegions.rowsClientHeight);
  expect(compactRegions.inspectorScrollHeight).toBeGreaterThan(
    compactRegions.inspectorClientHeight,
  );
  writeFileSync(
    testInfo.outputPath('geometry-evidence.json'),
    JSON.stringify(geometryEvidence, null, 2),
  );

  const history = await request.get('/api/imports?limit=50');
  expect(history.ok()).toBe(true);
  const sessions = (await history.json()).data.items as Array<{
    importSessionId: string;
    sourceSha256: string;
  }>;
  expect(sessions.some((item) => item.importSessionId === xlsxSession.importSessionId)).toBe(true);
  expect(sessions.every((item) => /^[0-9a-f]{64}$/.test(item.sourceSha256))).toBe(true);
  expect(project.id).toBeTruthy();
  expect(geometryEvidence).toHaveLength(13);
  expect(runtimeFailures).toEqual([]);
});

test('P5B-B real disposable Project Apply, partial confirmation, backup, and history', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const runtimeFailures: string[] = [];
  const geometryEvidence: GeometryEvidence[] = [];
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
  const created = await createSession(request, 'PROJECT', project.id);
  await upload(
    request,
    created.importSessionId,
    'p5b-b-project-apply.csv',
    Buffer.from('Tag,Location,Quantity\nP5BNEW,Owner UAT Lobby,2\n,Blocked row,1'),
  );
  let sessionResponse = await request.get(`/api/imports/${created.importSessionId}`);
  let session = (await sessionResponse.json()).data as {
    sessionRevision: number;
    previewFingerprint: string;
    destinationFingerprint: string;
    applyPlanFingerprint: string | null;
  };
  const reconcileResponse = await request.post(
    `/api/imports/${created.importSessionId}/reconcile`,
    {
      data: {
        expectedSessionRevision: session.sessionRevision,
        expectedPreviewFingerprint: session.previewFingerprint,
      },
    },
  );
  expect(reconcileResponse.ok()).toBe(true);
  session = (await reconcileResponse.json()).data;
  const rowsResponse = await request.get(`/api/imports/${created.importSessionId}/rows?limit=50`);
  const rowPage = (await rowsResponse.json()).data as {
    items: Array<{
      importRowId: string;
      rowVersion: number;
      reconciliation: { canonicalTag: string | null };
    }>;
  };
  const readyRow = rowPage.items.find((row) => row.reconciliation.canonicalTag === 'P5BNEW')!;
  const actionResponse = await request.patch(
    `/api/imports/${created.importSessionId}/rows/${readyRow.importRowId}/action`,
    {
      data: {
        expectedSessionRevision: session.sessionRevision,
        expectedRowVersion: readyRow.rowVersion,
        action: { type: 'PROJECT_CREATE_ONLY' },
      },
    },
  );
  expect(actionResponse.ok()).toBe(true);
  sessionResponse = await request.get(`/api/imports/${created.importSessionId}`);
  session = (await sessionResponse.json()).data;
  const blockedFullApply = await request.post(`/api/imports/${created.importSessionId}/apply`, {
    data: {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: session.previewFingerprint,
      destinationFingerprint: session.destinationFingerprint,
      applyPlanFingerprint: session.applyPlanFingerprint,
      idempotencyKey: 'p5b-e2e-full-apply-blocked',
      mode: 'ALL',
      confirmPartial: false,
    },
  });
  expect(blockedFullApply.status()).toBe(409);
  expect((await blockedFullApply.json()).error.code).toBe('IMPORT_PARTIAL_CONFIRMATION_REQUIRED');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/v4/imports');
  await page.evaluate(() => {
    window.localStorage.setItem('scli.v4.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await page.getByRole('button', { name: 'Import History', exact: true }).first().click();
  await page
    .getByRole('dialog', { name: 'Import History' })
    .getByRole('button', { name: /p5b-b-project-apply\.csv/ })
    .click();
  await expect(page.getByRole('button', { name: /P5BNEW/ })).toBeVisible();
  await page.getByRole('button', { name: /P5BNEW/ }).click();
  await expect(page.getByRole('complementary', { name: 'Row Inspector' })).toContainText('TAG NEW');
  await capture(page, testInfo, '13-p5b-b-reconciled-new-row-dark-1440', geometryEvidence);
  await expect(page.getByRole('button', { name: /Row action: Create Project-only/ })).toBeVisible();
  await capture(page, testInfo, '14-p5b-b-action-and-impact', geometryEvidence);
  await openWorkflowStep(page, 'Apply');
  await expect(page.getByText('1 rows will change')).toBeVisible();
  await expect(page.getByText(/1 create .* 1 blocked/)).toBeVisible();
  await capture(page, testInfo, '15-p5b-b-plan-summary-full-apply-blocked', geometryEvidence);
  await page.getByRole('button', { name: 'Apply Ready Rows Only' }).click();
  const confirm = page.getByRole('dialog', { name: 'Apply 1 rows' });
  await expect(confirm).toContainText('Unapplied rows remain in this session.');
  await expect(confirm).toContainText('verified workspace backup');
  await capture(page, testInfo, '16-p5b-b-partial-apply-confirmation', geometryEvidence);
  await confirm.getByRole('button', { name: 'Apply 1 rows' }).click();
  const successfulResult = page.getByRole('region', { name: 'Apply terminal result' });
  await expect(successfulResult).toContainText(/SUCCEEDED · 1 applied/);
  await expect(successfulResult).toContainText('Failed: 0');
  await capture(page, testInfo, '17-p5b-b-apply-success', geometryEvidence);
  await page.getByRole('button', { name: 'Import History', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Import History' })).toBeVisible();
  await capture(page, testInfo, '18-p5b-b-history-terminal-attempt', geometryEvidence);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1080, height: 900 });
  await capture(page, testInfo, '19-p5b-b-compact-partial-result', geometryEvidence);

  const luminaires = await request.get(`/api/projects/${project.id}/workspace`);
  expect(luminaires.ok()).toBe(true);
  const workspace = (await luminaires.json()).data as { luminaires: Array<{ tag: string }> };
  expect(workspace.luminaires.filter((item) => item.tag === 'P5BNEW')).toHaveLength(1);
  expect(runtimeFailures).toEqual([]);
});

test('P5B-B complete A-L Owner UAT, partial failure, terminal evidence, and 27-view matrix', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const runtimeFailures: string[] = [];
  const geometryEvidence: GeometryEvidence[] = [];
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

  const createProject = await request.post('/api/projects', {
    data: {
      projectName: 'P5B Project Apply UAT',
      clientName: 'Disposable Owner UAT',
      projectType: 'Lighting Layout',
      description: 'Deterministic disposable A-L Project Apply fixture.',
      siteLocation: 'Dubai',
      designStage: 'DetailedDesign',
      lightingScope: 'P5B closure evidence only.',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: '2028-12-15',
      crmReference: `P5B-UAT-${Date.now()}`,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(createProject.ok(), await createProject.text()).toBe(true);
  const project = (await createProject.json()).data.project as { id: string };
  const fixtureResponse = await request.post('/api/test/p5b-owner-uat/seed', {
    data: { projectId: project.id },
  });
  expect(fixtureResponse.ok(), await fixtureResponse.text()).toBe(true);
  const fixture = (await fixtureResponse.json()).data as {
    latestVersionId: string;
    olderVersionId: string;
    failureVersionId: string;
    revisionCountBefore: number;
    libraryCountsBefore: Record<string, number>;
  };
  const created = await createSession(request, 'PROJECT', project.id);
  await upload(
    request,
    created.importSessionId,
    'p5b-owner-uat-a-l.csv',
    Buffer.from(
      [
        'Tag,Manufacturer,Product Family,Ordering Code,Wattage [W],Location,Unit,Quantity,Project Category',
        'NEW-001,,,,,New lobby,No.,2,Downlight',
        'EXIST-001,,,,,Existing updated,No.,2,Downlight',
        'DUP-001,,,,,Duplicate ambiguity,No.,1,Downlight',
        'LINK-001,ERCO,Owner UAT Exact Family,UAT-EXACT,99,Linked updated,No.,3,Spotlight',
        'LIB-EXACT,ERCO,Owner UAT Exact Family,UAT-EXACT,14,Library lobby,No.,2,Spotlight',
        'POSSIBLE-001,ERCO,Owner UAT Exact Family,NO-MATCH,12,Possible,No.,1,Spotlight',
        ',ERCO,Blank Tag,BLANK,12,Blocked blank,No.,1,Downlight',
        'SKIP-001,,,,,Skip row,No.,1,Downlight',
        'INVALID-001,,,,,Invalid quantity,No.,-1,Downlight',
        'STALE-001,,,,,Stale updated,No.,2,Downlight',
        'OLDVER-001,ERCO,Owner UAT Exact Family,UAT-EXACT,12,Older version,No.,1,Spotlight',
        'FAIL-001,ERCO,Owner UAT Failure Family,UAT-FAIL,12,Failure row,No.,1,Spotlight',
      ].join('\n'),
    ),
  );

  const getSession = async () => {
    const response = await request.get(`/api/imports/${created.importSessionId}`);
    expect(response.ok()).toBe(true);
    return (await response.json()).data as {
      sessionRevision: number;
      previewFingerprint: string;
      destinationFingerprint: string;
      applyPlanFingerprint: string | null;
    };
  };
  const getRows = async () => {
    const response = await request.get(
      `/api/imports/${created.importSessionId}/rows?limit=50&filter=ALL`,
    );
    expect(response.ok()).toBe(true);
    return (await response.json()).data.items as Array<{
      importRowId: string;
      rowVersion: number;
      applyState: string;
      intendedAction: { type: string; olderPublishedVersion?: boolean } | null;
      reconciliation: {
        canonicalTag: string | null;
        projectState: string;
        exactLibraryMatch: { versionId: string } | null;
        possibleLibraryMatches: unknown[];
        ignoredLinkedChanges: unknown[];
      };
    }>;
  };
  const reconcile = async () => {
    const session = await getSession();
    const response = await request.post(`/api/imports/${created.importSessionId}/reconcile`, {
      data: {
        expectedSessionRevision: session.sessionRevision,
        expectedPreviewFingerprint: session.previewFingerprint,
      },
    });
    expect(response.ok()).toBe(true);
  };
  const setAction = async (
    tag: string,
    action:
      | { type: 'PROJECT_CREATE_ONLY' | 'PROJECT_UPDATE_EXISTING' }
      | { type: 'SKIP'; reason: string }
      | { type: 'PROJECT_ADD_FROM_LIBRARY'; versionId: string },
  ) => {
    const session = await getSession();
    const row = (await getRows()).find((item) => item.reconciliation.canonicalTag === tag)!;
    const response = await request.patch(
      `/api/imports/${created.importSessionId}/rows/${row.importRowId}/action`,
      {
        data: {
          expectedSessionRevision: session.sessionRevision,
          expectedRowVersion: row.rowVersion,
          action,
        },
      },
    );
    expect(response.ok(), `${tag}: ${await response.text()}`).toBe(true);
  };
  const openSession = async () => {
    await page.goto('/v4/imports');
    await page.getByRole('button', { name: 'Import History', exact: true }).first().click();
    await page
      .getByRole('dialog', { name: 'Import History' })
      .getByRole('button', { name: /p5b-owner-uat-a-l\.csv/ })
      .click();
    // Inspect and Apply both retain the source-row preview, including terminal results.
    await expect(page.getByRole('button', { name: /NEW-001/ })).toBeVisible();
  };
  const selectRow = async (tag: string) => {
    await page.getByRole('button', { name: new RegExp(tag) }).click();
  };

  await reconcile();
  const rows = await getRows();
  expect(rows).toHaveLength(12);
  expect(
    rows.find((row) => row.reconciliation.canonicalTag === 'DUP-001')?.reconciliation,
  ).toMatchObject({ projectState: 'TAG_AMBIGUOUS' });
  expect(
    rows.find((row) => row.reconciliation.canonicalTag === 'LINK-001')?.reconciliation,
  ).toMatchObject({ projectState: 'TAG_LIBRARY_LINKED' });
  expect(
    rows.find((row) => row.reconciliation.canonicalTag === 'LINK-001')?.reconciliation
      .ignoredLinkedChanges.length,
  ).toBeGreaterThan(0);
  expect(
    rows.find((row) => row.reconciliation.canonicalTag === 'POSSIBLE-001')?.reconciliation
      .possibleLibraryMatches.length,
  ).toBeGreaterThan(0);
  expect(
    rows.find((row) => row.reconciliation.canonicalTag === null)?.reconciliation,
  ).toMatchObject({ projectState: 'TAG_ABSENT' });

  await setAction('LINK-001', { type: 'PROJECT_UPDATE_EXISTING' });
  const mutateBinding = await request.post('/api/test/p5b-owner-uat/mutate-binding-version');
  expect(mutateBinding.ok()).toBe(true);
  let session = await getSession();
  const staleBindingApply = await request.post(`/api/imports/${created.importSessionId}/apply`, {
    data: {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: session.previewFingerprint,
      destinationFingerprint: session.destinationFingerprint,
      applyPlanFingerprint: session.applyPlanFingerprint,
      idempotencyKey: 'p5b-owner-uat-stale-binding-proof',
      mode: 'READY_ONLY',
      confirmPartial: true,
    },
  });
  expect(staleBindingApply.status()).toBe(409);
  expect((await staleBindingApply.json()).error.code).toBe('IMPORT_TARGET_CHANGED');

  await reconcile();
  await setAction('STALE-001', { type: 'PROJECT_UPDATE_EXISTING' });
  const mutateStale = await request.post('/api/test/p5b-owner-uat/mutate-stale-target');
  expect(mutateStale.ok()).toBe(true);
  session = await getSession();
  const staleApply = await request.post(`/api/imports/${created.importSessionId}/apply`, {
    data: {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: session.previewFingerprint,
      destinationFingerprint: session.destinationFingerprint,
      applyPlanFingerprint: session.applyPlanFingerprint,
      idempotencyKey: 'p5b-owner-uat-stale-proof',
      mode: 'READY_ONLY',
      confirmPartial: true,
    },
  });
  expect(staleApply.status()).toBe(409);
  expect((await staleApply.json()).error.code).toBe('IMPORT_TARGET_CHANGED');

  await reconcile();
  await setAction('NEW-001', { type: 'PROJECT_CREATE_ONLY' });
  await openSession();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    window.localStorage.setItem('scli.v4.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await capture(page, testInfo, '20-a-l-reconciled-overview', geometryEvidence);
  await selectRow('NEW-001');
  await capture(page, testInfo, '21-new-project-only-row', geometryEvidence);
  const newRow = (await getRows()).find((row) => row.reconciliation.canonicalTag === 'NEW-001')!;
  await page.getByLabel(`Select import row 2`).check();
  await expect(page.getByText('1 selected')).toBeVisible();
  await capture(page, testInfo, '22-bulk-row-selection', geometryEvidence);
  await page.getByPlaceholder('Project Category').fill('Feature Downlight');
  await page.getByPlaceholder('Location').fill('Owner UAT Lobby');
  await page.getByPlaceholder('Unit').fill('No.');
  await page.getByPlaceholder('Quantity').fill('2.5');
  await capture(page, testInfo, '23-bulk-project-fields', geometryEvidence);
  await page.getByRole('button', { name: 'Set fields' }).click();
  await expect(page.getByText('0 selected')).toHaveCount(0);
  expect(newRow.importRowId).toBeTruthy();

  await setAction('EXIST-001', { type: 'PROJECT_UPDATE_EXISTING' });
  await setAction('LINK-001', { type: 'PROJECT_UPDATE_EXISTING' });
  await setAction('LIB-EXACT', {
    type: 'PROJECT_ADD_FROM_LIBRARY',
    versionId: fixture.latestVersionId,
  });
  await setAction('SKIP-001', { type: 'SKIP', reason: 'Explicit Owner UAT skip' });
  await setAction('STALE-001', { type: 'PROJECT_UPDATE_EXISTING' });
  await setAction('OLDVER-001', {
    type: 'PROJECT_ADD_FROM_LIBRARY',
    versionId: fixture.olderVersionId,
  });
  await setAction('FAIL-001', {
    type: 'PROJECT_ADD_FROM_LIBRARY',
    versionId: fixture.failureVersionId,
  });

  await openSession();
  await selectRow('EXIST-001');
  await capture(page, testInfo, '24-existing-project-sparse-impact', geometryEvidence);
  await selectRow('LINK-001');
  await capture(page, testInfo, '25-linked-ignored-technical-fields', geometryEvidence);
  await selectRow('LIB-EXACT');
  await capture(page, testInfo, '26-exact-library-match', geometryEvidence);
  await selectRow('OLDVER-001');
  await expect(page.getByText('Older published version selected.')).toBeVisible();
  await capture(page, testInfo, '27-older-published-version-warning', geometryEvidence);
  await selectRow('POSSIBLE-001');
  await capture(page, testInfo, '28-possible-library-match', geometryEvidence);
  await selectRow('BLANK');
  await capture(page, testInfo, '29-blank-tag-blocked', geometryEvidence);
  await selectRow('DUP-001');
  await capture(page, testInfo, '30-historical-ambiguous-tag', geometryEvidence);
  await selectRow('NEW-001');
  await page.getByRole('button', { name: /^Row action:/ }).click();
  await capture(page, testInfo, '31-row-action-selector', geometryEvidence);
  await page.keyboard.press('Escape');
  await openWorkflowStep(page, 'Apply');
  await capture(page, testInfo, '32-apply-plan-summary', geometryEvidence);

  session = await getSession();
  const blockedFullApply = await request.post(`/api/imports/${created.importSessionId}/apply`, {
    data: {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: session.previewFingerprint,
      destinationFingerprint: session.destinationFingerprint,
      applyPlanFingerprint: session.applyPlanFingerprint,
      idempotencyKey: 'p5b-owner-uat-full-blocked',
      mode: 'ALL',
      confirmPartial: false,
    },
  });
  expect(blockedFullApply.status()).toBe(409);
  expect((await blockedFullApply.json()).error.code).toBe('IMPORT_PARTIAL_CONFIRMATION_REQUIRED');
  await capture(page, testInfo, '33-full-apply-blocked-unresolved', geometryEvidence);
  await expect(page.getByRole('button', { name: 'Apply Ready Rows Only' })).toBeVisible();
  await capture(page, testInfo, '34-apply-ready-rows-only-action', geometryEvidence);
  await page.getByRole('button', { name: 'Apply Ready Rows Only' }).click();
  const confirm = page.getByRole('dialog', { name: /Apply \d+ rows/ });
  await expect(confirm).toContainText('Unapplied rows remain in this session.');
  await capture(page, testInfo, '35-partial-apply-confirmation', geometryEvidence);
  await capture(page, testInfo, '36-verified-backup-before-mutation', geometryEvidence);
  const removeFailureAsset = await request.post('/api/test/p5b-owner-uat/remove-failure-asset');
  expect(removeFailureAsset.ok()).toBe(true);
  await confirm.getByRole('button', { name: /Apply \d+ rows/ }).click();
  await expect(page.getByRole('region', { name: 'Apply terminal result' })).toContainText(
    /Partially applied/i,
  );
  await capture(page, testInfo, '37-partial-failure-result', geometryEvidence);
  const terminal = page.getByRole('region', { name: 'Apply terminal result' });
  await expect(terminal).toContainText('Created Project-only');
  await expect(terminal).toContainText('Updated linked Project-owned fields');
  await expect(terminal).toContainText('Added from Library');
  await expect(terminal).toContainText('Remaining Blocked');
  await expect(terminal).toContainText('Remaining Unresolved');
  await capture(page, testInfo, '38-terminal-detailed-breakdown', geometryEvidence);
  await terminal.getByRole('button', { name: 'Open Project Luminaires' }).click();
  await expect(page).toHaveURL(`/v4/projects/${project.id}/luminaires`);
  await openSession();
  await openWorkflowStep(page, 'Apply');
  const reopenedTerminal = page.getByRole('region', { name: 'Apply terminal result' });
  await reopenedTerminal.getByRole('button', { name: 'View Failed Rows' }).click();
  await capture(page, testInfo, '39-view-failed-rows', geometryEvidence);
  await page.getByRole('button', { name: 'Import History', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Import History' })).toBeVisible();
  await capture(page, testInfo, '40-history-terminal-attempt', geometryEvidence);
  await page.keyboard.press('Escape');
  await page.reload();
  await openSession();
  await expect(page.getByRole('region', { name: 'Apply terminal result' })).toContainText(
    /Partially applied/i,
  );
  await capture(page, testInfo, '41-restart-reopened-session', geometryEvidence);
  await page.evaluate(() => {
    window.localStorage.setItem('scli.v4.theme', 'light');
    document.documentElement.dataset.theme = 'light';
  });
  await capture(page, testInfo, '42-light-1440x900', geometryEvidence);
  await page.evaluate(() => {
    window.localStorage.setItem('scli.v4.theme', 'dark');
    document.documentElement.dataset.theme = 'dark';
  });
  await capture(page, testInfo, '43-dark-1440x900', geometryEvidence);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await capture(page, testInfo, '44-terminal-1920x1080', geometryEvidence);
  await page.setViewportSize({ width: 1080, height: 900 });
  await capture(page, testInfo, '45-terminal-compact-desktop', geometryEvidence);
  await capture(page, testInfo, '46-terminal-owner-actions', geometryEvidence);

  const attemptsResponse = await request.get(
    `/api/imports/${created.importSessionId}/apply-attempts`,
  );
  expect(attemptsResponse.ok()).toBe(true);
  const attempt = (await attemptsResponse.json()).data[0] as {
    applyAttemptId: string;
    idempotencyKey: string;
    state: string;
    counts: Record<string, number>;
  };
  expect(attempt.state).toBe('PARTIALLY_APPLIED');
  expect(attempt.counts).toMatchObject({
    created: 1,
    updatedProjectOnlyResult: 2,
    updatedLinkedProjectFieldsResult: 1,
    addedFromLibrary: 2,
    skippedResult: 1,
    failed: 1,
    remainingBlocked: 3,
    remainingUnresolved: 1,
  });
  const replay = await request.post(`/api/imports/${created.importSessionId}/apply`, {
    data: {
      expectedSessionRevision: session.sessionRevision,
      previewFingerprint: session.previewFingerprint,
      destinationFingerprint: session.destinationFingerprint,
      applyPlanFingerprint: session.applyPlanFingerprint,
      idempotencyKey: attempt.idempotencyKey,
      mode: 'READY_ONLY',
      confirmPartial: true,
    },
  });
  expect(replay.ok()).toBe(true);
  expect((await replay.json()).data.applyAttemptId).toBe(attempt.applyAttemptId);
  const evidenceResponse = await request.get('/api/test/p5b-owner-uat/evidence');
  expect(evidenceResponse.ok()).toBe(true);
  const evidence = (await evidenceResponse.json()).data as {
    revisionCount: number;
    libraryCounts: Record<string, number>;
  };
  expect(evidence.revisionCount).toBe(fixture.revisionCountBefore);
  expect(evidence.libraryCounts).toEqual(fixture.libraryCountsBefore);
  expect(geometryEvidence).toHaveLength(27);
  expect(runtimeFailures).toEqual([]);
  writeFileSync(
    testInfo.outputPath('p5b-owner-uat-a-l-evidence.json'),
    JSON.stringify({ fixture, attempt, evidence, geometryEvidence }, null, 2),
  );
});
