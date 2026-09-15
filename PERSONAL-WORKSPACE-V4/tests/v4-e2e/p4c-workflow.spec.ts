import { createRequire } from 'node:module';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const require = createRequire(import.meta.url);
const desktopBridge = require('../../desktop/external-application-bridge.cjs') as {
  executeDesktopHandoff(
    input: { handoffId: string; expectedAction: string },
    dataRoot: string,
    handlers: Record<string, unknown>,
  ): Promise<unknown>;
};
const ownedRoots: string[] = [];

test.afterEach(() => {
  for (const root of ownedRoots.splice(0).reverse()) {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function runtimeRoot(): string {
  const activeMarkers = readdirSync(tmpdir())
    .filter(
      (name) => name.startsWith('scli-personal-playwright-api-run-') && name.endsWith('.json'),
    )
    .map((name) => {
      const markerPath = path.join(tmpdir(), name);
      return {
        marker: JSON.parse(readFileSync(markerPath, 'utf8')) as {
          runtimeRoot: string;
          state: string;
        },
        modifiedAt: statSync(markerPath).mtimeMs,
      };
    })
    .filter(({ marker }) => marker.state === 'running' && existsSync(marker.runtimeRoot))
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  if (!activeMarkers[0]) {
    throw new Error('Disposable Personal E2E runtime is not active.');
  }
  return activeMarkers[0].marker.runtimeRoot;
}

test('P4C real API workflow, opaque manual handoff, storage retry, and Output Activity', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const projectFolder = mkdtempSync(path.join(tmpdir(), 'scli-p4c-project-'));
  const offlineFolder = `${projectFolder}-offline`;
  const pickerRoot = mkdtempSync(path.join(tmpdir(), 'scli-p4c-picker-'));
  ownedRoots.push(projectFolder, offlineFolder, pickerRoot);

  const create = await request.post('/api/projects', {
    data: {
      projectName: 'P4C Disposable Workflow',
      clientName: 'Disposable Client',
      projectType: 'Lighting Layout',
      description: 'Disposable P4C real API acceptance.',
      siteLocation: 'Dubai',
      designStage: 'DetailedDesign',
      lightingScope: 'P4C only.',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 2,
      requiredDeliveryDate: '2028-12-15',
      connectFolderPath: projectFolder,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  if (!create.ok())
    throw new Error(`Project create failed ${create.status()}: ${await create.text()}`);
  const project = (await create.json()).data.project as { id: string };

  const sourcePath = path.join(projectFolder, 'registered-source.dwg');
  writeFileSync(sourcePath, 'registered-source');
  const documentResponse = await request.post(`/api/projects/${project.id}/documents`, {
    data: {
      category: 'Drawing',
      documentNumber: 'CAD-SOURCE',
      title: 'Registered AutoCAD Source',
      revision: '',
      status: 'Working',
      filePath: sourcePath,
      issuedTo: '',
      issueDate: null,
      notes: '',
    },
  });
  expect(documentResponse.ok()).toBe(true);
  const document = (await documentResponse.json()).data as { id: string };

  const startBody = {
    application: 'AUTOCAD',
    artifactType: 'CAD_WORKING_DRAWING',
    targetRevisionId: null,
    sourceDocumentId: document.id,
  };
  const firstStart = await request.post(`/api/personal/projects/${project.id}/tool-sessions`, {
    data: startBody,
  });
  if (firstStart.status() !== 201) {
    throw new Error(`Tool Session start failed ${firstStart.status()}: ${await firstStart.text()}`);
  }
  const firstSession = (await firstStart.json()).data as {
    reusedExisting: boolean;
    toolSession: { toolContextId: string };
    launchHandoff: { handoffId: string; action: string };
  };
  expect(firstSession.reusedExisting).toBe(false);
  expect(firstSession.launchHandoff.action).toBe('LAUNCH_TOOL');
  const duplicateStart = await request.post(`/api/personal/projects/${project.id}/tool-sessions`, {
    data: startBody,
  });
  expect(duplicateStart.status()).toBe(200);
  const duplicateSession = (await duplicateStart.json()).data as typeof firstSession;
  expect(duplicateSession.reusedExisting).toBe(true);
  expect(duplicateSession.toolSession.toolContextId).toBe(firstSession.toolSession.toolContextId);

  const mappingOutput = path.join(
    runtimeRoot(),
    'automation-sessions',
    firstSession.toolSession.toolContextId,
    'inbox',
    'mapping-working.dwg',
  );
  writeFileSync(mappingOutput, 'mapping-working-v1');
  let mappingCapture: { captureId: string; structuredReason: { code: string } | null } | undefined;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/personal/projects/${project.id}/captures?view=attention&limit=8&page=0`,
        );
        const data = (await response.json()).data as {
          items: Array<{ captureId: string; structuredReason: { code: string } | null }>;
        };
        mappingCapture = data.items.find(
          (capture) => capture.structuredReason?.code === 'DESTINATION_MAPPING_REQUIRED',
        );
        return Boolean(mappingCapture);
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  await page.goto(`/v4/projects/${project.id}/files`);
  await page.getByRole('button', { name: 'Output Activity' }).click();
  await expect(page.getByText('Output filing needs configuration')).toBeVisible();
  await page.getByText('mapping-working.dwg').click();
  const mappingInspector = page.locator('.v4-output-activity .v4-inspector');
  await expect(
    mappingInspector.getByRole('heading', { name: 'Output filing needs configuration' }),
  ).toBeVisible();
  await expect(
    mappingInspector.getByRole('button', { name: 'Configure Output Filing' }),
  ).toBeVisible();

  const workspaceResponse = await request.get(`/api/projects/${project.id}/workspace`);
  const workspace = (await workspaceResponse.json()).data as {
    folderConfigurationFingerprint: string;
    outputMappings: Array<{ outputTypeId: string; destinationFolderId: string | null }>;
    folderSnapshot: {
      folders: Array<{
        folderId: string;
        parentFolderId: string | null;
        name: string;
        enabled: boolean;
      }>;
    };
  };
  const repairFolder = workspace.folderSnapshot.folders.find(
    (folder) => folder.enabled && folder.parentFolderId !== null,
  );
  expect(repairFolder?.folderId).toBeTruthy();
  const foldersById = new Map(
    workspace.folderSnapshot.folders.map((folder) => [folder.folderId, folder]),
  );
  const destinationParts: string[] = [];
  for (let cursor = repairFolder; cursor;) {
    destinationParts.unshift(cursor.name);
    cursor = cursor.parentFolderId ? foldersById.get(cursor.parentFolderId) : undefined;
  }
  mkdirSync(path.join(projectFolder, ...destinationParts), { recursive: true });
  const mappingRepair = await request.patch(
    `/api/personal/projects/${project.id}/output-mappings/cadWorkingDrawing`,
    {
      data: {
        destinationFolderId: repairFolder!.folderId,
        expectedFingerprint: workspace.folderConfigurationFingerprint,
      },
    },
  );
  expect(mappingRepair.ok()).toBe(true);
  const mappingRetry = await request.post(
    `/api/personal/captures/${mappingCapture!.captureId}/retry`,
    { data: {} },
  );
  expect(mappingRetry.ok()).toBe(true);
  expect((await mappingRetry.json()).data).toMatchObject({ state: 'COMPLETED' });

  const manualFile = path.join(pickerRoot, 'manual-working.dwg');
  writeFileSync(manualFile, 'manual-working-v1');
  const manualResponse = await request.post(
    `/api/personal/projects/${project.id}/manual-capture-contexts`,
    { data: { artifactType: 'CAD_WORKING_DRAWING', targetRevisionId: null } },
  );
  expect(manualResponse.status()).toBe(201);
  const manual = (await manualResponse.json()).data as {
    pickerHandoff: { handoffId: string; action: 'MANUAL_FILE_PICK' };
  };
  // The context is admitted while connected, then storage is taken offline
  // before the opaque Desktop picker copy reaches the inbox.
  renameSync(projectFolder, offlineFolder);
  await desktopBridge.executeDesktopHandoff(
    {
      handoffId: manual.pickerHandoff.handoffId,
      expectedAction: manual.pickerHandoff.action,
    },
    runtimeRoot(),
    { pickFile: async () => manualFile },
  );

  // Restore only after the real P4B routing gate has surfaced storage recovery.
  let attentionCapture: { captureId: string; structuredReason: { code: string } } | undefined;
  let observedItems: unknown[] = [];
  try {
    await expect
      .poll(
        async () => {
          const response = await request.get(
            `/api/personal/projects/${project.id}/captures?view=attention&limit=8&page=0`,
          );
          const data = (await response.json()).data as {
            items: Array<{ captureId: string; structuredReason: { code: string } | null }>;
          };
          observedItems = data.items;
          attentionCapture = data.items.find(
            (capture) => capture.structuredReason?.code === 'STORAGE_UNAVAILABLE',
          ) as typeof attentionCapture;
          return Boolean(attentionCapture);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  } catch (error) {
    throw new Error(`Storage recovery was not surfaced: ${JSON.stringify(observedItems)}.`, {
      cause: error,
    });
  }

  await page.goto(`/v4/projects/${project.id}/files`);
  await page.getByRole('button', { name: 'Output Activity' }).click();
  await expect(page.getByText('Project storage is unavailable')).toBeVisible();
  await page.getByText('manual-working.dwg').click();
  const storageInspector = page.locator('.v4-output-activity .v4-inspector');
  await expect(
    storageInspector.getByRole('heading', { name: 'Project storage is unavailable' }),
  ).toBeVisible();
  await expect(storageInspector.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  renameSync(offlineFolder, projectFolder);
  const retry = await request.post(`/api/personal/captures/${attentionCapture!.captureId}/retry`, {
    data: {},
  });
  expect(retry.ok()).toBe(true);
  const retriedCapture = (await retry.json()).data;
  expect(retriedCapture, JSON.stringify(retriedCapture)).toMatchObject({
    state: 'COMPLETED',
    routingDecision: 'USER_CONFIRMED',
    artifactVersion: 2,
    allowedRecoveryActions: ['OPEN', 'REVEAL'],
  });

  const openHandoff = await request.post(
    `/api/personal/captures/${attentionCapture!.captureId}/file-handoff`,
    { data: { action: 'OPEN' } },
  );
  expect(openHandoff.ok()).toBe(true);
  const open = (await openHandoff.json()).data as {
    handoffId: string;
    action: 'OPEN_CAPTURE_FILE';
  };
  await expect(
    desktopBridge.executeDesktopHandoff(
      { handoffId: open.handoffId, expectedAction: open.action },
      runtimeRoot(),
      { openPath: async () => '' },
    ),
  ).resolves.toMatchObject({ action: 'OPEN_CAPTURE_FILE', opened: true });

  const managedWorkspaceResponse = await request.get(`/api/projects/${project.id}/workspace`);
  const managedWorkspace = (await managedWorkspaceResponse.json()).data as {
    documents: Array<{ id: string; filePath: string }>;
  };
  const managedDocument = managedWorkspace.documents.find(
    (candidate) => candidate.filePath === retriedCapture.finalProjectRelativeLocator,
  );
  expect(managedDocument?.id).toBeTruthy();
  const documentHandoff = await request.post(
    `/api/personal/projects/${project.id}/documents/${managedDocument!.id}/file-handoff`,
    { data: { action: 'REVEAL' } },
  );
  expect(documentHandoff.ok()).toBe(true);
  const reveal = (await documentHandoff.json()).data as {
    handoffId: string;
    action: 'REVEAL_CAPTURE_FILE';
  };
  await expect(
    desktopBridge.executeDesktopHandoff(
      { handoffId: reveal.handoffId, expectedAction: reveal.action },
      runtimeRoot(),
      { reveal: () => undefined },
    ),
  ).resolves.toMatchObject({ action: 'REVEAL_CAPTURE_FILE', opened: true });

  await page.goto(`/v4/projects/${project.id}/files`);
  await page.getByRole('button', { name: 'Output Activity' }).click();
  await page.getByRole('button', { name: 'Recent' }).click();
  await expect(page.getByText('manual-working.dwg')).toBeVisible();
  await expect(page.getByText('Completed').first()).toBeVisible();
  await expect(
    page.getByText('The output needs attention before filing can continue.'),
  ).toHaveCount(0);
  await expect(page.getByText('Automation Enabled')).toHaveCount(0);

  await page.setViewportSize({ width: 1080, height: 900 });
  await page.getByText('manual-working.dwg').click();
  const completedInspector = page.locator('.v4-output-activity .v4-inspector');
  await expect(completedInspector.getByText('Output filed successfully')).toBeVisible();
  await expect(
    completedInspector.getByText(retriedCapture.finalProjectRelativeLocator, { exact: true }),
  ).toBeVisible();
  await expect(completedInspector.getByText('Needs Attention')).toHaveCount(0);
  await completedInspector.getByText('Technical details').click();

  const assertInspectorGeometry = async () => {
    expect(
      await completedInspector.evaluate((element) => {
        const body = element.querySelector('.v4-inspector__body');
        const longValues = [...element.querySelectorAll('.v4-output-activity__technical-value')];
        return {
          inspector: element.scrollWidth <= element.clientWidth + 1,
          body: body ? body.scrollWidth <= body.clientWidth + 1 : false,
          values: longValues.every((value) => value.scrollWidth <= value.clientWidth + 1),
          document:
            document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        };
      }),
    ).toEqual({ inspector: true, body: true, values: true, document: true });
    await expect(completedInspector.getByRole('button', { name: 'Open File' })).toBeVisible();
    await expect(completedInspector.getByRole('button', { name: 'Reveal' })).toBeVisible();
  };
  await assertInspectorGeometry();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => window.localStorage.setItem('scli.v4.theme', 'dark'));
  await page.reload();
  await page.getByRole('button', { name: 'Output Activity' }).click();
  await page.getByRole('button', { name: 'Recent' }).click();
  await page.getByText('manual-working.dwg').click();
  await assertInspectorGeometry();

  await page.setViewportSize({ width: 1080, height: 900 });
  await completedInspector.getByRole('button', { name: 'Close capture Inspector' }).click();
  await page.getByRole('button', { name: 'Start Tool Session' }).click();
  const toolDrawer = page.getByRole('dialog', { name: 'Start Tool Session' });
  await expect(toolDrawer).toBeVisible();
  expect(
    await toolDrawer.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight + 1;
    }),
  ).toBe(true);
  await toolDrawer.getByRole('button', { name: 'Cancel' }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);

  await page.goto('/v4/settings?section=integrations');
  await expect(page.getByRole('heading', { name: 'Integrations & Automation' })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  expect(
    await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      vertical: document.documentElement.scrollHeight <= innerHeight + 1,
    })),
  ).toEqual({ horizontal: true, vertical: true });
});
