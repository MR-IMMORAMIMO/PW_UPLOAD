import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const futureDate = '2028-12-15';
const disposableProjectFolders: string[] = [];

test.afterEach(() => {
  for (const folder of disposableProjectFolders.splice(0)) {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});

async function settleAndCapture(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  await page.waitForTimeout(260);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage,
    animations: 'allow',
  });
}

test('owner visual hardening workflow and Settings delta', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1080, height: 900 });
  const projectFolder = mkdtempSync(path.join(tmpdir(), 'scli-v4-owner-project-'));
  disposableProjectFolders.push(projectFolder);
  const create = await request.post('/api/projects', {
    data: {
      projectName: 'Owner Visual Hardening',
      clientName: 'Disposable Client',
      projectType: 'Lighting Layout',
      description: 'Disposable owner visual hardening project.',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'Visual acceptance only.',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: futureDate,
      connectFolderPath: projectFolder,
      crmReference: `P3C-OWNER-${Date.now()}`,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(create.ok()).toBe(true);
  let project = (await create.json()).data.project as { id: string; status: string };
  for (const target of ['InProgress', 'ClientReview']) {
    const transition = await request.post(`/api/projects/${project.id}/status`, {
      data: {
        status: target,
        expectedCurrentStatus: project.status,
        transitionId: crypto.randomUUID(),
      },
    });
    expect(transition.ok()).toBe(true);
    project = (await transition.json()).data as { id: string; status: string };
  }
  const root = `/v4/projects/${project.id}`;
  const luminaire = (tag: string) => ({
    tag,
    category: 'Downlight',
    imagePath: `C:\\fixtures\\${tag}.png`,
    description: 'Architectural downlight',
    manufacturer: 'LumenWorks',
    model: `${tag}-150`,
    wattage: '12W',
    lumens: '1200 lm',
    lightColor: '3000K',
    cri: '> 80',
    beamAngle: '36°',
    ipRating: 'IP44',
    mounting: 'Recessed',
    cutout: '125 mm',
    driver: 'Remote',
    control: 'DALI',
    emergency: 'No',
    datasheetPath: `C:\\fixtures\\${tag}.pdf`,
    location: 'Lobby',
    unit: 'No.',
    quantity: 6,
    notes: '',
    sourceName: '',
    dimensions: '150 × 90 mm',
    bodyColorFinish: 'White',
  });
  const luminaires = [] as Array<ReturnType<typeof luminaire> & { id: string }>;
  for (const draft of [luminaire('DL01'), luminaire('DL02'), luminaire('DL03')]) {
    const response = await request.post(`/api/projects/${project.id}/luminaires`, { data: draft });
    expect(response.ok()).toBe(true);
    luminaires.push((await response.json()).data as (typeof luminaires)[number]);
  }
  const documents = Array.from({ length: 10 }, (_, index) => ({
    category: 'Drawing',
    documentNumber: `L-${String(index + 1).padStart(3, '0')}`,
    title: `Lighting Layout ${String(index + 1).padStart(2, '0')}`,
    revision: 'REV_01',
    status: 'Working',
    filePath: `C:\\Projects\\Owner\\L-${String(index + 1).padStart(3, '0')}.dwg`,
    issuedTo: '',
    issueDate: null,
    notes: index === 0 ? 'Owner inspector evidence.' : '',
  }));
  for (const draft of documents) {
    const response = await request.post(`/api/projects/${project.id}/documents`, { data: draft });
    expect(response.ok()).toBe(true);
  }
  const comparisons = (
    item: ReturnType<typeof luminaire> & { id: string },
    statuses: string[],
  ) => ({
    luminaireId: item.id,
    tag: item.tag,
    datasheetPath: item.datasheetPath,
    fileName: `${item.tag}.pdf`,
    analyzedAt: '2026-08-23T08:30:00.000Z',
    engine: 'SCLI Local Intelligence 1.0',
    privacyMode: 'LocalOnly',
    status: 'Ready',
    message: 'Local analysis complete.',
    pageCount: 2,
    textAvailable: true,
    comparisons: statuses.map((status, index) => ({
      fieldKey: ['manufacturer', 'model', 'wattage', 'lumens', 'beamAngle'][index] ?? 'model',
      label: ['Manufacturer', 'Model', 'Wattage', 'Lumen Output', 'Beam Angle'][index] ?? 'Model',
      value: index === 2 ? '15W' : `Datasheet ${index + 1}`,
      alternatives: [],
      confidence: 91 - index,
      pageNumber: 1,
      evidence: `Evidence for ${item.tag} field ${index + 1}`,
      ambiguous: false,
      scheduleValue: index === 2 ? '12W' : `Schedule ${index + 1}`,
      status,
    })),
    counts: { Matched: 0, Mismatch: 0, MissingSchedule: 0, MissingDatasheet: 0, NeedsReview: 0 },
  });
  const analyses = [
    comparisons(luminaires[0]!, [
      'MissingSchedule',
      'Matched',
      'Mismatch',
      'MissingDatasheet',
      'NeedsReview',
    ]),
    comparisons(luminaires[1]!, ['Mismatch', 'Matched']),
    comparisons(luminaires[2]!, ['Matched']),
  ];
  const backupRows = Array.from({ length: 18 }, (_, index) => ({
    fileName: `workspace-backup-${String(index + 1).padStart(2, '0')}.sqlite`,
    filePath: `C:\\Disposable\\Backups\\workspace-backup-${String(index + 1).padStart(2, '0')}.sqlite`,
    sizeBytes: 2_097_152 + index,
    createdAt: `2026-08-${String(18 - index).padStart(2, '0')}T08:00:00.000Z`,
    reason: 'manual',
  }));
  const settingsFixture = {
    projectRoot: 'C:\\Disposable\\Projects',
    defaultFolderProfile: 'Blank structure',
    defaultInputMode: 'Manual',
    autoOpenProjectFolder: false,
    designerName: 'Owner UAT',
    companyName: 'Scientechnic',
    companyLogoPath: '',
    accentColor: '#008C95',
    timeZone: 'Asia/Dubai',
    backupRetention: 30,
    updatedAt: '2026-08-23T08:00:00.000Z',
  };

  await page.route(`**/api/projects/${project.id}/luminaire-assets`, (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  let technicalRun = false;
  const technicalBatch = {
    projectId: project.id,
    items: analyses.map((analysis) => ({
      luminaireId: analysis.luminaireId,
      tag: analysis.tag,
      status: 'VERIFIED',
      reasonCode: 'NONE',
      message: analysis.message,
      analysis,
    })),
    summary: {
      total: analyses.length,
      analyzed: analyses.length,
      verified: analyses.length,
      needsAdoption: 0,
      failed: 0,
      unverified: 0,
    },
  };
  await page.route(
    `**/api/projects/${project.id}/local-intelligence/analyze-datasheets`,
    (route) => {
      technicalRun = true;
      return route.fulfill({ json: { data: technicalBatch } });
    },
  );
  await page.route(`**/api/projects/${project.id}/local-intelligence/datasheet-results`, (route) =>
    route.fulfill({ json: { data: technicalRun ? technicalBatch : null } }),
  );
  await page.route(`**/api/projects/${project.id}/local-intelligence`, (route) =>
    route.fulfill({
      json: {
        data: {
          projectId: project.id,
          generatedAt: '2026-08-23T08:30:00.000Z',
          engine: 'SCLI Local Intelligence 1.0',
          privacyMode: 'LocalOnly',
          readinessScore: 80,
          checks: [],
          brief: { headline: '', summary: '', nextActions: [], warnings: [] },
          fileClassifications: [],
          stats: {
            luminaireCount: 3,
            linkedDatasheets: 3,
            missingDatasheets: 0,
            indexedFiles: 0,
            classificationsNeedingReview: 0,
          },
        },
      },
    }),
  );
  await page.route('**/api/personal/backups', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { data: backupRows } })
      : route.continue(),
  );
  await page.route('**/api/personal/settings', (route) =>
    route.fulfill({ json: { data: settingsFixture } }),
  );
  await page.route('**/api/personal/project-types', (route) =>
    route.fulfill({ json: { data: [] } }),
  );
  await page.route('**/api/folder-profiles/catalog', (route) =>
    route.fulfill({
      json: {
        data: {
          schemaVersion: '1.0',
          profiles: [],
          defaultProfileRef: { kind: 'blank' },
          defaultProfileId: null,
          effectiveDefaultRef: { kind: 'blank' },
          legacyDefaultFolderProfile: 'Blank structure',
          legacyDefaultMatch: 'blank',
          legacyImportRequired: false,
        },
      },
    }),
  );
  await page.route('**/api/folder-profiles', (route) => route.fulfill({ json: { data: [] } }));
  await page.route('**/api/users', (route) => route.fulfill({ json: { data: [] } }));

  await page.goto(`${root}/comments`);
  await expect(page.getByRole('button', { name: 'Project storage and more' })).toHaveCount(0);
  await page
    .getByRole('button', { name: /Internal/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: /Internal/ }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await settleAndCapture(page, testInfo, '01-comments-accent-header-light-1080');

  await page.evaluate(() => window.localStorage.setItem('scli.v4.theme', 'dark'));
  await page.goto(`${root}/technical-check`);
  await page.getByRole('button', { name: 'Run Technical Check' }).first().click();
  await page.locator('button[aria-haspopup="listbox"][aria-label="Result"]').click();
  await page.getByRole('option', { name: 'All', exact: true }).click();
  await expect(page.getByRole('button', { name: /^DL01: \d+ checks$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^DL02: \d+ checks$/ })).toBeVisible();
  await expect(page.getByText('Showing 1 to 3 of 3 luminaires')).toBeVisible();
  await page.getByRole('button', { name: /^Review DL01: \d+ checks$/ }).click();
  const review = page.getByRole('dialog', { name: 'Technical Verification — DL01' });
  await expect(review.getByRole('button', { name: 'Wattage', exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Close Review', exact: true }).click();
  await settleAndCapture(page, testInfo, '02-technical-fields-dark-1080');

  await page.evaluate(() => window.localStorage.setItem('scli.v4.theme', 'light'));
  await page.goto(`${root}/files`);
  await expect(page.locator('.v4-files__row')).toHaveCount(8);
  await expect(page.getByRole('complementary', { name: 'Working file details' })).toHaveCount(0);
  await page.getByText('Lighting Layout 10').click();
  await expect(page.getByRole('complementary', { name: 'Working file details' })).toBeVisible();
  await settleAndCapture(page, testInfo, '03-files-inspector-light-1080');
  await page.getByRole('button', { name: 'Close working file details' }).click();
  await expect(page.locator('.v4-files__workspace')).not.toHaveClass(/inspector-open/);
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Showing 9–10 of 10 files')).toBeVisible();
  await settleAndCapture(page, testInfo, '04-files-pagination-light-1080');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/v4/settings');
  for (const title of [
    'Workspace',
    'Identity & Branding',
    'Catalogues',
    'Data & Backup',
    'Appearance',
  ]) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
  const settingsGeometry = await page.evaluate(() => {
    const card = (name: string) =>
      [...document.querySelectorAll('h2')]
        .find((node) => node.textContent === name)!
        .parentElement!.parentElement!.parentElement!.getBoundingClientRect();
    const workspace = card('Workspace'),
      identity = card('Identity & Branding'),
      catalogues = card('Catalogues'),
      appearance = card('Appearance');
    return {
      workspaceTop: workspace.top,
      identityTop: identity.top,
      cataloguesBottom: catalogues.bottom,
      appearanceBottom: appearance.bottom,
      documentOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  expect(Math.abs(settingsGeometry.workspaceTop - settingsGeometry.identityTop)).toBeLessThan(2);
  // Friday Settings removes artificial equal-height columns; bounded sections may scroll vertically.
  expect(settingsGeometry.cataloguesBottom - settingsGeometry.workspaceTop).toBeLessThanOrEqual(
    900,
  );
  expect(settingsGeometry.appearanceBottom - settingsGeometry.identityTop).toBeLessThanOrEqual(900);
  expect(settingsGeometry.documentOverflow).toBe(false);
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(3);
  await settleAndCapture(page, testInfo, 'A-settings-final-light-1440x900', false);
  await page.getByRole('button', { name: 'View All Backups' }).click();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(18);
  await settleAndCapture(page, testInfo, 'B-settings-all-backups-light-1440x900', false);
  await page.getByRole('button', { name: 'Show Recent Backups' }).click();
  await page.setViewportSize({ width: 1080, height: 900 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await settleAndCapture(page, testInfo, 'C-settings-final-light-1080', false);

  await page.goto(`${root}/summary`);
  const nextAction = page.getByRole('region', { name: 'Next Action', exact: true });
  await expect(nextAction).toContainText('Revision Required');
  await expect(nextAction.getByRole('button', { name: /Revision Required/ })).toBeEnabled();
  const statusTrigger = page.locator('.v4-project-status-control__trigger');
  await statusTrigger.click();
  const lifecycleMenu = page.getByRole('menu', { name: 'Change Project status' });
  await expect(lifecycleMenu.getByRole('menuitem')).toHaveCount(7);
  await expect(
    lifecycleMenu.getByRole('menuitem', { name: /Client Review.*Current/i }),
  ).toBeDisabled();
  await expect(
    lifecycleMenu.getByRole('menuitem', { name: /On Hold.*Directly available/i }),
  ).toBeEnabled();
  await expect(
    lifecycleMenu.getByRole('menuitem', { name: /Completed.*Directly available/i }),
  ).toBeEnabled();
  const revisionRequired = lifecycleMenu.getByRole('menuitem', {
    name: /Revision Required.*Specialized available.*reason required/i,
  });
  await expect(revisionRequired).toBeEnabled();
  await settleAndCapture(page, testInfo, 'D-client-review-specialized-menu-light-1080', false);

  await revisionRequired.click();
  const reasonDialog = page.getByRole('dialog', { name: 'Revision Required' });
  await expect(reasonDialog).toBeVisible();
  await expect(reasonDialog.getByLabel('Reason')).toBeFocused();
  await expect(reasonDialog.getByRole('button', { name: 'Keep Current Status' })).toBeEnabled();
  await expect(
    reasonDialog.getByRole('button', { name: 'Confirm Revision Required' }),
  ).toBeEnabled();
  await settleAndCapture(page, testInfo, 'E-revision-required-reason-light-1080', false);
  await reasonDialog.getByRole('button', { name: 'Keep Current Status' }).click();

  const mainFlow = page.getByRole('group', { name: 'Project workflow stages' });
  await expect(mainFlow).toContainText('Design');
  await expect(mainFlow).toContainText('Client Review');
  await expect(mainFlow).toContainText('Technical');
  await expect(mainFlow).toContainText('Issue');
  await expect(mainFlow).toContainText('Revision');
  await expect(mainFlow.locator('[data-stage="client-review"]')).toHaveAttribute(
    'data-state',
    'active',
  );
  await expect(mainFlow.locator('[data-state="active"]')).toHaveCount(1);
  await settleAndCapture(page, testInfo, 'F-overview-workflow-cycle-light-1080', false);

  await nextAction.getByRole('button', { name: /Revision Required/ }).click();
  await expect(page).toHaveURL(`${root}/workflow-timeline`);
  await expect(statusTrigger).toContainText('Client Review');
  await page.goto(`${root}/summary`);
  await statusTrigger.click();
  await revisionRequired.click();
  const nextActionReasonDialog = page.getByRole('dialog', { name: 'Revision Required' });
  await nextActionReasonDialog
    .getByLabel('Reason')
    .fill('Client requested a coordinated revision.');
  await nextActionReasonDialog.getByRole('button', { name: 'Confirm Revision Required' }).click();
  await expect(nextAction).toContainText('Start Revision');
  await settleAndCapture(page, testInfo, 'G-revision-required-next-action-light-1080', false);
  await nextAction.getByRole('button', { name: /Start Revision/ }).click();
  await expect(page).toHaveURL(`${root}/workflow-timeline`);
  await expect(statusTrigger).toContainText('Revision Required');
});
