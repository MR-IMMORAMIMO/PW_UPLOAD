import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDocumentIntelligenceFixture } from '../../apps/api/src/infrastructure/document-intelligence/testing/DocumentIntelligenceFixture';

type Admission = { documentId: string; documentVersionId: string; processingAttemptId: string };
type DocumentRead = { id: string; rowVersion: number; processingState: string; lifecycle: string };
type ProjectRead = { id: string; version: number; updatedAt: string };
type FindingRead = {
  code: string;
  competingValues?: Array<{ value: string | number | null; unit: string | null }>;
};
const conflictingProjectId = 'aaaaaaaa-0000-4000-8000-000000000001';

async function data<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!response.ok()) throw new Error(`${response.status()}: ${await response.text()}`);
  return ((await response.json()) as { data: T }).data;
}

async function waitForTerminal(request: APIRequestContext, documentId: string) {
  await expect
    .poll(
      async () => {
        const response = await request.get(`/api/documents/${documentId}/processing`);
        if (!response.ok()) return `HTTP_${response.status()}`;
        return ((await response.json()) as { data: { state: string } }).data.state;
      },
      { timeout: 90_000, intervals: [200, 400, 800] },
    )
    .toMatch(/COMPLETE|INCOMPLETE|FAILED_RETRYABLE|CANCELLED|INTERRUPTED/);
}

async function decide(
  request: APIRequestContext,
  documentId: string,
  body: Record<string, unknown>,
) {
  const document = await data<DocumentRead>(await request.get(`/api/documents/${documentId}`));
  return data<DocumentRead>(
    await request.post(`/api/documents/${documentId}/decisions`, {
      data: { ...body, expectedRowVersion: document.rowVersion },
    }),
  );
}

async function createSyntheticProject(request: APIRequestContext, projectName: string) {
  return data<{ project: ProjectRead }>(
    await request.post('/api/projects', {
      data: {
        projectName,
        clientName: 'Synthetic Owner UAT Client',
        projectType: 'Lighting Design',
        description: 'Disposable Phase 5C Owner-workflow evidence.',
        siteLocation: 'Synthetic Site',
        designStage: 'DetailedDesign',
        lightingScope: 'Disposable document intelligence only.',
        priority: 'Normal',
        complexity: 'Medium',
        estimatedHours: 1,
        requiredDeliveryDate: '2028-12-15',
        idempotencyKey: randomUUID(),
      },
    }),
  );
}

test('P5C retains A-L evidence services and Owner authority after standalone page retirement', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const runtimeFailures: string[] = [];
  page.on('pageerror', (error) => runtimeFailures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeFailures.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/') && [403, 404, 500].includes(response.status()))
      runtimeFailures.push(
        `${response.status()}: ${response.request().method()} ${response.url()}`,
      );
  });

  const alphaProject = (await createSyntheticProject(request, 'Alpha Palace')).project;
  const betaProject = (await createSyntheticProject(request, 'Beta Palace')).project;
  const canonicalBefore = {
    alpha: await data<ProjectRead>(await request.get(`/api/projects/${alphaProject.id}`)),
    beta: await data<ProjectRead>(await request.get(`/api/projects/${betaProject.id}`)),
    alphaRevisions: await data<unknown[]>(
      await request.get(`/api/projects/${alphaProject.id}/revisions`),
    ),
    betaRevisions: await data<unknown[]>(
      await request.get(`/api/projects/${betaProject.id}/revisions`),
    ),
    alphaLuminaires: (
      await data<{ luminaires: unknown[] }>(
        await request.get(`/api/projects/${alphaProject.id}/workspace`),
      )
    ).luminaires,
    betaLuminaires: (
      await data<{ luminaires: unknown[] }>(
        await request.get(`/api/projects/${betaProject.id}/workspace`),
      )
    ).luminaires,
  };
  const admitted = new Map<string, Admission[]>();
  for (const fixture of createDocumentIntelligenceFixture({
    projectAId: alphaProject.id,
    projectBId: conflictingProjectId,
  })) {
    const rows: Admission[] = [];
    for (const source of fixture.documents) {
      const response = await request.post('/api/documents/source', {
        headers: {
          'content-type': 'application/octet-stream',
          'x-document-file-name': encodeURIComponent(source.fileName),
          'x-document-idempotency-key': `p5c-${fixture.key}-${randomUUID()}`,
          ...(fixture.key === 'E' && source.projectContextId
            ? { 'x-document-project-id': source.projectContextId }
            : {}),
        },
        data: source.bytes,
      });
      const admission = await data<Admission>(response);
      rows.push(admission);
    }
    admitted.set(fixture.key, rows);
  }
  expect([...admitted.values()].flat()).toHaveLength(15);
  await Promise.all(
    [...admitted.values()].flat().map((item) => waitForTerminal(request, item.documentId)),
  );

  for (const item of [...admitted.values()].flat()) {
    const decisions = await data<unknown[]>(
      await request.get(`/api/documents/${item.documentId}/decisions`),
    );
    expect(decisions).toEqual([]);
  }
  for (const key of ['H', 'I'] as const)
    for (const item of admitted.get(key)!) {
      const findings = await data<FindingRead[]>(
        await request.get(`/api/documents/${item.documentId}/findings`),
      );
      expect(findings.some((finding) => finding.code.endsWith('_CONFLICT'))).toBe(false);
    }

  const aEvidence = await data<{ items: Array<{ canonicalField: string; method: string }> }>(
    await request.get(`/api/documents/${admitted.get('A')![0]!.documentId}/evidence`),
  );
  const aProcessing = await data<{ state: string; errorCode: string | null }>(
    await request.get(`/api/documents/${admitted.get('A')![0]!.documentId}/processing`),
  );
  expect(aProcessing).toMatchObject({ state: 'COMPLETE', errorCode: null });
  expect(aEvidence.items.map((item) => item.canonicalField)).toEqual(
    expect.arrayContaining(['MAINTENANCE_FACTOR', 'ILLUMINANCE_AVERAGE', 'QUANTITY']),
  );
  expect(aEvidence.items.every((item) => item.method === 'NATIVE_TEXT')).toBe(true);
  const bEvidence = await data<{ items: Array<{ method: string; confidence: number }> }>(
    await request.get(`/api/documents/${admitted.get('B')![0]!.documentId}/evidence`),
  );
  expect(bEvidence.items.some((item) => item.method === 'OCR' && item.confidence > 0)).toBe(true);
  const duplicateRelationships = await data<Array<{ type: string }>>(
    await request.get(`/api/documents/${admitted.get('C')![0]!.documentId}/relationships`),
  );
  expect(duplicateRelationships.map((item) => item.type)).toContain('EXACT_DUPLICATE');
  expect(
    (
      await data<DocumentRead>(
        await request.get(`/api/documents/${admitted.get('K')![0]!.documentId}`),
      )
    ).processingState,
  ).toBe('FAILED_RETRYABLE');

  const eEvidence = await data<
    Array<{ candidateProjectId: string | null; strength: string; contradictory: boolean }>
  >(await request.get(`/api/documents/${admitted.get('E')![0]!.documentId}/association-evidence`));
  const eProcessing = await data<{ state: string; errorCode: string | null }>(
    await request.get(`/api/documents/${admitted.get('E')![0]!.documentId}/processing`),
  );
  expect(eProcessing).toMatchObject({ state: 'COMPLETE', errorCode: null });
  expect(eEvidence).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        candidateProjectId: alphaProject.id,
        strength: 'STRONG',
        contradictory: true,
      }),
      expect.objectContaining({
        candidateProjectId: conflictingProjectId,
        strength: 'STRONG',
        contradictory: true,
      }),
    ]),
  );
  const fEvidence = await data<Array<{ candidateProjectId: string | null; strength: string }>>(
    await request.get(`/api/documents/${admitted.get('F')![0]!.documentId}/association-evidence`),
  );
  expect(new Set(fEvidence.map((item) => item.candidateProjectId))).toEqual(
    new Set([alphaProject.id, betaProject.id]),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/v4/dashboard');
  await page.evaluate(() => {
    window.localStorage.setItem('scli.v4.theme', 'dark');
    window.localStorage.setItem('scli.v4.sidebar.mode', 'extended');
  });
  await page.goto('/v4/documents');
  await expect(page).toHaveURL(/\/v4\/projects$/);
  await expect(page.getByRole('heading', { name: 'Document Review Center' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Document Review', exact: true })).toHaveCount(0);

  for (const key of ['H', 'I'] as const)
    for (const item of admitted.get(key)!) {
      await decide(request, item.documentId, {
        action: 'CONFIRM_PROJECT_ASSOCIATION',
        reason: 'Disposable A-L exact Project confirmation.',
        projectId: alphaProject.id,
      });
      await decide(request, item.documentId, {
        action: 'ACCEPT_DOCUMENT',
        reason: 'Disposable A-L evidence accepted.',
      });
      await decide(request, item.documentId, {
        action: 'INCLUDE_COMPARISON',
        reason: 'Disposable A-L consistency scope.',
      });
    }
  const consistency = await data<{ eligibleDocuments: number }>(
    await request.post('/api/documents/consistency/recompute', {
      data: { projectId: alphaProject.id, idempotencyKey: randomUUID() },
    }),
  );
  expect(consistency.eligibleDocuments).toBe(5);

  const hFindings = (
    await Promise.all(
      admitted
        .get('H')!
        .map(async (item) =>
          data<FindingRead[]>(await request.get(`/api/documents/${item.documentId}/findings`)),
        ),
    )
  ).flat();
  expect(hFindings.map((finding) => finding.code)).toContain('LUMINAIRE_QUANTITY_CONFLICT');
  expect(
    hFindings.find((finding) => finding.code === 'LUMINAIRE_QUANTITY_CONFLICT')?.competingValues,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ value: 24 }),
      expect.objectContaining({ value: 22 }),
    ]),
  );
  const hTargetEntry = (
    await Promise.all(
      admitted.get('H')!.map(async (item) => ({
        item,
        findings: await data<FindingRead[]>(
          await request.get(`/api/documents/${item.documentId}/findings`),
        ),
      })),
    )
  ).find((entry) =>
    entry.findings.some((finding) => finding.code === 'LUMINAIRE_QUANTITY_CONFLICT'),
  )!;
  expect(
    hTargetEntry.findings.some((finding) => finding.code === 'LUMINAIRE_QUANTITY_CONFLICT'),
  ).toBe(true);

  const iTargetEntry = (
    await Promise.all(
      admitted.get('I')!.map(async (item) => ({
        item,
        findings: await data<FindingRead[]>(
          await request.get(`/api/documents/${item.documentId}/findings`),
        ),
      })),
    )
  ).find((entry) => entry.findings.some((finding) => finding.code === 'ORDERING_CODE_CONFLICT'))!;
  expect(iTargetEntry.findings.map((finding) => finding.code)).toEqual(
    expect.arrayContaining([
      'ORDERING_CODE_CONFLICT',
      'WATTAGE_CONFLICT',
      'CCT_CONFLICT',
      'BEAM_CONFLICT',
    ]),
  );
  const competing = iTargetEntry.findings
    .flatMap((finding) => finding.competingValues ?? [])
    .map((item) => item.value);
  expect(competing).toEqual(
    expect.arrayContaining(['A100', 'A200', 12, 15, 3000, 4000, '24 deg', '36 deg']),
  );

  const malformed = admitted.get('K')![0]!;
  const malformedDocument = await data<DocumentRead>(
    await request.get(`/api/documents/${malformed.documentId}`),
  );
  await data(
    await request.post(`/api/documents/${malformed.documentId}/retry`, {
      data: {
        expectedRowVersion: malformedDocument.rowVersion,
        idempotencyKey: `p5c-retry-${randomUUID()}`,
      },
    }),
  );
  await waitForTerminal(request, malformed.documentId);
  const retryDecisions = await data<Array<{ action: string }>>(
    await request.get(`/api/documents/${malformed.documentId}/decisions`),
  );
  expect(retryDecisions.map((item) => item.action)).toContain('RETRY_PROCESSING');

  expect(await data<ProjectRead>(await request.get(`/api/projects/${alphaProject.id}`))).toEqual(
    canonicalBefore.alpha,
  );
  expect(await data<ProjectRead>(await request.get(`/api/projects/${betaProject.id}`))).toEqual(
    canonicalBefore.beta,
  );
  expect(
    await data<unknown[]>(await request.get(`/api/projects/${alphaProject.id}/revisions`)),
  ).toEqual(canonicalBefore.alphaRevisions);
  expect(
    await data<unknown[]>(await request.get(`/api/projects/${betaProject.id}/revisions`)),
  ).toEqual(canonicalBefore.betaRevisions);
  expect(
    (
      await data<{ luminaires: unknown[] }>(
        await request.get(`/api/projects/${alphaProject.id}/workspace`),
      )
    ).luminaires,
  ).toEqual(canonicalBefore.alphaLuminaires);
  expect(
    (
      await data<{ luminaires: unknown[] }>(
        await request.get(`/api/projects/${betaProject.id}/workspace`),
      )
    ).luminaires,
  ).toEqual(canonicalBefore.betaLuminaires);
  expect(runtimeFailures).toEqual([]);
});
