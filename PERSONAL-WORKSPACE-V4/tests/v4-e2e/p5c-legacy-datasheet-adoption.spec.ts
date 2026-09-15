import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

async function data<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!response.ok()) throw new Error(`${response.status()}: ${await response.text()}`);
  return ((await response.json()) as { data: T }).data;
}

async function createProject(request: APIRequestContext): Promise<string> {
  const result = await data<{ project: { id: string } }>(
    await request.post('/api/projects', {
      data: {
        projectName: 'P5C Legacy Datasheet Adoption',
        clientName: 'Disposable Legacy Adoption Client',
        projectType: 'Lighting Design',
        description: 'Disposable ten-Luminaire legacy adoption acceptance fixture.',
        siteLocation: 'Synthetic Site',
        designStage: 'DetailedDesign',
        lightingScope: 'Legacy Datasheet adoption only.',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 1,
        requiredDeliveryDate: '2028-12-15',
        idempotencyKey: randomUUID(),
      },
    }),
  );
  return result.project.id;
}

test('P5C adopts exact legacy bytes with one backup and preserves partial outcomes', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const projectId = await createProject(request);
  const fixture = await data<{
    projectRoot: string;
    items: Array<{
      luminaireId: string;
      assetVersionId: string;
    }>;
  }>(
    await request.post('/api/test/p5c-legacy-adoption/seed', {
      data: { projectId },
    }),
  );
  expect(fixture.items).toHaveLength(10);

  const initialHealth = await data<{ state: string }>(
    await request.get(`/api/projects/${projectId}/storage-health`),
  );
  expect(initialHealth.state).toBe('LEGACY_UNVERIFIED');
  const blockedInspection = await data<{
    backupId: string | null;
    items: Array<{ status: string; reasonCode: string }>;
  }>(await request.get(`/api/projects/${projectId}/legacy-datasheet-adoption`));
  expect(blockedInspection.backupId).toBeNull();
  expect(
    blockedInspection.items.filter((item) => item.status === 'BLOCKED_STORAGE_UNVERIFIED'),
  ).toHaveLength(10);

  const checksBeforeConnection = await data<{
    summary: { total: number; analyzed: number; needsAdoption: number };
  }>(await request.post(`/api/projects/${projectId}/local-intelligence/analyze-datasheets`));
  expect(checksBeforeConnection.summary).toMatchObject({
    total: 10,
    analyzed: 0,
    needsAdoption: 10,
  });
  await page.goto(`/v4/projects/${projectId}/technical-check`);
  await expect(
    page
      .getByTestId('v4-technical-check')
      .getByText('Legacy Datasheet needs adoption', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Adopt Legacy Datasheets' })).toBeDisabled();

  const project = await data<{ version: number }>(await request.get(`/api/projects/${projectId}`));
  const connected = await data<{ health: { state: string } }>(
    await request.post(`/api/projects/${projectId}/storage/reconnect`, {
      data: {
        candidatePath: fixture.projectRoot,
        intent: 'ADOPT_LEGACY',
        expectedVersion: project.version,
      },
    }),
  );
  expect(connected.health.state).toBe('CONNECTED');

  const inspection = await data<{
    backupId: string | null;
    items: Array<{ status: string; reasonCode: string }>;
  }>(await request.get(`/api/projects/${projectId}/legacy-datasheet-adoption`));
  expect(inspection.items.filter((item) => item.status === 'READY_TO_ADOPT')).toHaveLength(10);

  const stableIds = fixture.items.map(({ luminaireId, assetVersionId }) => ({
    luminaireId,
    assetVersionId,
  }));
  const adopted = await data<{
    backupId: string | null;
    items: Array<{ status: string; reasonCode: string }>;
  }>(
    await request.post(`/api/projects/${projectId}/legacy-datasheet-adoption`, {
      data: { items: stableIds },
    }),
  );
  expect(adopted.backupId).not.toBeNull();
  expect(adopted.items.filter((item) => item.status === 'ADOPTED')).toHaveLength(10);
  expect(adopted.items.filter((item) => item.status.startsWith('BLOCKED_'))).toHaveLength(0);

  const replay = await data<{
    backupId: string | null;
    items: Array<{ status: string }>;
  }>(
    await request.post(`/api/projects/${projectId}/legacy-datasheet-adoption`, {
      data: { items: stableIds },
    }),
  );
  expect(replay.backupId).toBeNull();
  expect(replay.items.filter((item) => item.status === 'ALREADY_MANAGED')).toHaveLength(10);

  const evidence = await data<{
    adoptionActivityCount: number;
    historicalNullHashCount: number;
    rows: Array<{
      currentAssetVersionId: string;
      originalAssetVersionId: string;
      currentLocatorKind: string;
      versionCount: number;
      sourceExists: boolean;
      sourceUnchanged: boolean;
    }>;
  }>(await request.get(`/api/test/p5c-legacy-adoption/evidence/${projectId}`));
  expect(evidence.adoptionActivityCount).toBe(10);
  expect(evidence.historicalNullHashCount).toBe(5);
  const managed = evidence.rows.filter((row) => row.currentLocatorKind === 'DATA_ROOT_RELATIVE');
  expect(managed).toHaveLength(10);
  expect(managed.filter((row) => row.versionCount === 3)).toHaveLength(1);
  expect(managed.filter((row) => row.versionCount === 2)).toHaveLength(9);
  expect(managed.every((row) => row.currentAssetVersionId !== row.originalAssetVersionId)).toBe(
    true,
  );
  expect(managed.every((row) => row.sourceExists && row.sourceUnchanged)).toBe(true);

  const completeChecks = await data<{
    summary: { total: number; analyzed: number; needsAdoption: number; failed: number };
  }>(await request.post(`/api/projects/${projectId}/local-intelligence/analyze-datasheets`));
  expect(completeChecks.summary).toMatchObject({
    total: 10,
    analyzed: 10,
    needsAdoption: 0,
    failed: 0,
  });
  const completeProcessingEvidence = await data<{ ocrPageCount: number }>(
    await request.get(`/api/test/p5c-legacy-adoption/evidence/${projectId}`),
  );
  expect(completeProcessingEvidence.ocrPageCount).toBeGreaterThan(0);

  const mixed = await data<{ hashFailureLuminaireId: string; legacyLuminaireId: string }>(
    await request.post(`/api/test/p5c-legacy-adoption/prepare-mixed-batch/${projectId}`),
  );

  const checks = await data<{
    items: Array<{
      luminaireId: string;
      status: string;
      reasonCode: string;
      analysis: { comparisons: Array<{ method?: string }> } | null;
    }>;
    summary: { total: number; analyzed: number; needsAdoption: number; failed: number };
  }>(await request.post(`/api/projects/${projectId}/local-intelligence/analyze-datasheets`));
  expect(checks.summary.total).toBe(10);
  expect(checks.summary.analyzed).toBe(8);
  expect(checks.summary.needsAdoption).toBe(1);
  expect(checks.summary.failed).toBe(1);
  expect(checks.items.filter((item) => item.analysis !== null)).toHaveLength(8);
  expect(checks.items.filter((item) => item.status === 'NEEDS_ADOPTION')).toHaveLength(1);
  expect(
    checks.items.find((item) => item.luminaireId === mixed.hashFailureLuminaireId),
  ).toMatchObject({ status: 'PROCESSING_FAILED', reasonCode: 'SOURCE_HASH_MISMATCH' });
  expect(checks.items.find((item) => item.luminaireId === mixed.legacyLuminaireId)).toMatchObject({
    status: 'NEEDS_ADOPTION',
    reasonCode: 'LEGACY_DATASHEET_REQUIRES_ADOPTION',
  });
  const processingEvidence = await data<{ ocrPageCount: number }>(
    await request.get(`/api/test/p5c-legacy-adoption/evidence/${projectId}`),
  );
  expect(processingEvidence.ocrPageCount).toBeGreaterThan(0);

  await page.reload();
  await expect(
    page
      .getByTestId('v4-technical-check')
      .getByText('Legacy Datasheet needs adoption', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Run Technical Check' }).click();
  await page.locator('button[aria-haspopup="listbox"][aria-label="Result"]').click();
  await page.getByRole('option', { name: 'All', exact: true }).click();
  const currentWorkspace = await data<{ luminaires: Array<{ id: string; tag: string }> }>(
    await request.get(`/api/projects/${projectId}/workspace`),
  );
  const legacyTag = currentWorkspace.luminaires.find(
    (item) => item.id === mixed.legacyLuminaireId,
  )!.tag;
  const adoptionRow = page.getByRole('button', { name: new RegExp(`^${legacyTag}: \\d+ checks$`) });
  const nextIssues = page
    .getByText(/^Showing \d+ to \d+ of \d+ luminaires$/)
    .locator('..')
    .getByRole('button', { name: 'Next page', exact: true });
  while (!(await adoptionRow.count()) && (await nextIssues.isEnabled())) await nextIssues.click();
  await expect(adoptionRow).toHaveCount(1);
  await adoptionRow.getByRole('button', { name: new RegExp(`^Review ${legacyTag}:`) }).click();
  const review = page.getByRole('dialog', { name: `Technical Verification — ${legacyTag}` });
  await expect(review).toContainText('Legacy Datasheet');
  await review.getByRole('button', { name: 'Close Review', exact: true }).click();
  const analyzedKpi = page.getByRole('button', { name: 'Datasheets Analyzed', exact: true });
  await expect(analyzedKpi).toContainText('8');
  await expect(analyzedKpi).toContainText('10 linked of 10');
  expect(checks.summary).toMatchObject({ analyzed: 8, needsAdoption: 1, failed: 1 });
});
