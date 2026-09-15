/* global window, document, innerWidth, innerHeight, getComputedStyle */
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { v4BuildProvenance } from '../apps/web-v4/buildProvenance.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2];
const packagedExecutable = process.argv[3];
if (packagedExecutable && !path.isAbsolute(packagedExecutable))
  throw new Error('Packaged executable must be an absolute path.');
if (!output || !path.isAbsolute(output)) throw new Error('Pass an absolute evidence directory.');
await mkdir(output, { recursive: true });
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'sct-final-v4-electron-'));
const launcher = path.join(temporaryRoot, 'launcher.cjs');
await mkdir(path.join(temporaryRoot, 'profile'));
const metadata = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
await writeFile(
  path.join(temporaryRoot, 'package.json'),
  JSON.stringify({ name: metadata.name, version: metadata.version, main: 'launcher.cjs' }),
);
// Only the app/data roots are supplied by this harness. The real desktop main,
// preload, production API and built renderer run unchanged against fresh data.
await writeFile(
  launcher,
  `const {app}=require('electron');\napp.setPath('userData',${JSON.stringify(path.join(temporaryRoot, 'profile'))});\napp.getAppPath=()=>${JSON.stringify(repositoryRoot)};\nrequire(${JSON.stringify(path.join(repositoryRoot, 'desktop/main.cjs'))});\n`,
);
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: temporaryRoot };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
const evidence = {
  temporaryRoot,
  repositoryRoot,
  startedAt: new Date().toISOString(),
  rendererErrors: [],
  routes: [],
  assets: [],
};
let app;
try {
  app = await electron.launch(
    packagedExecutable
      ? {
          executablePath: packagedExecutable,
          args: [`--user-data-dir=${path.join(temporaryRoot, 'profile')}`],
          env,
          timeout: 60000,
        }
      : { args: [temporaryRoot], env, timeout: 60000 },
  );
  evidence.mainLogs = [];
  app
    .process()
    .stdout?.on('data', (chunk) =>
      evidence.mainLogs.push({ stream: 'stdout', text: String(chunk) }),
    );
  app
    .process()
    .stderr?.on('data', (chunk) =>
      evidence.mainLogs.push({ stream: 'stderr', text: String(chunk) }),
    );
  evidence.startup = await app.evaluate(({ app }) => ({
    name: app.getName(),
    userData: app.getPath('userData'),
    appPath: app.getAppPath(),
  }));
  await writeFile(path.join(output, 'startup.json'), JSON.stringify(evidence.startup, null, 2));
  const page = await app.firstWindow({ timeout: 60000 });
  page.on('pageerror', (error) => evidence.rendererErrors.push(error.message));
  await page.waitForURL(/\/v4\//, { timeout: 60000 });
  await page.locator('html[data-sct-build]').waitFor();
  const origin = new URL(page.url()).origin;
  const disk = JSON.parse(
    await readFile(path.join(repositoryRoot, 'apps/web-v4/dist/build-info.json'), 'utf8'),
  );
  const served = await (await page.request.get(`${origin}/v4/build-info.json`)).json();
  const dom = await page.locator('html').getAttribute('data-sct-build');
  assert.deepEqual(served, disk);
  assert.equal(dom, disk.sourceSha256);
  assert.equal(
    v4BuildProvenance(repositoryRoot).metadata.sourceSha256,
    disk.sourceSha256,
    'Build must match the current source.',
  );
  evidence.provenance = {
    disk,
    served,
    dom,
    url: page.url(),
    electron: await app.evaluate(({ app }) => ({
      appPath: app.getAppPath(),
      userData: app.getPath('userData'),
      version: app.getVersion(),
    })),
  };
  assert.equal(
    path.resolve(evidence.provenance.electron.userData),
    path.resolve(temporaryRoot, 'profile'),
    'Electron profile must stay disposable.',
  );
  const assets = await page
    .locator('script[src],link[rel="stylesheet"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('src') || node.getAttribute('href')),
    );
  for (const asset of assets) {
    if (!asset?.startsWith('/v4/assets/')) continue;
    const local = await readFile(
      path.join(repositoryRoot, 'apps/web-v4/dist', asset.slice('/v4/'.length)),
    );
    const remote = await (await page.request.get(`${origin}${asset}`)).body();
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    assert.equal(hash(local), hash(remote));
    evidence.assets.push({ asset, sha256: hash(local) });
  }
  for (const size of [
    { width: 1366, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2400, height: 1440 },
  ]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.unmaximize();
      window.setContentSize(size.width, size.height);
    }, size);
    for (const route of ['dashboard', 'projects', 'luminaire-library', 'settings', 'new']) {
      await page.goto(`${origin}/v4/${route}`);
      await page
        .locator('h1')
        .filter({
          hasText:
            route === 'new'
              ? 'New Project'
              : route === 'luminaire-library'
                ? 'Luminaire Library'
                : route === 'projects'
                  ? 'Projects'
                  : route === 'settings'
                    ? 'Settings'
                    : 'Dashboard',
        })
        .waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
        const animations = document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
        await Promise.allSettled(animations.map((animation) => animation.finished));
      });
      await page.screenshot({
        path: path.join(output, `${route}-${size.width}x${size.height}.png`),
      });
      const geometry = await page.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        page: {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        },
        panels: [...document.querySelectorAll('.final-ui-reference')].map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            transform: getComputedStyle(node).transform,
          };
        }),
      }));
      assert.ok(
        geometry.page.width <= geometry.viewport.width + 1,
        `${route} must not overflow the window width`,
      );
      assert.ok(
        geometry.panels.every(
          (panel) => panel.transform === 'none' || panel.transform === 'matrix(1, 0, 0, 1, 0, 0)',
        ),
        `${route} must not scale the whole page`,
      );
      evidence.routes.push({ route, size, geometry });
    }
  }
  const projectRoot = path.join(temporaryRoot, 'projects');
  await mkdir(projectRoot);
  const settings = await (await page.request.get(`${origin}/api/personal/settings`)).json();
  const settingsInput = { ...settings.data };
  delete settingsInput.updatedAt;
  const settingsResponse = await page.request.patch(`${origin}/api/personal/settings`, {
    data: { ...settingsInput, projectRoot },
  });
  assert.equal(settingsResponse.ok(), true, await settingsResponse.text());
  const types = await (await page.request.get(`${origin}/api/project-types`)).json();
  await page.goto(`${origin}/v4/new`);
  const wizard = page.getByRole('dialog', { name: 'New Project', exact: true });
  await wizard.getByLabel('projectName', { exact: true }).fill('Electron Final V4 Verification');
  await wizard.getByLabel('clientName', { exact: true }).fill('Disposable Verification Client');
  await wizard
    .getByLabel('projectType', { exact: true })
    .selectOption(types.data.find((type) => type.isActive).name);
  await wizard.getByLabel('Project value', { exact: true }).fill('100000');
  await wizard.getByLabel('priority', { exact: true }).selectOption('Low');
  await wizard.getByRole('button', { name: 'Next: Scope & Services', exact: true }).click();
  await wizard
    .getByLabel('Scope Summary', { exact: true })
    .fill('Persisted lighting scope from the final Electron wizard.');
  await wizard.getByRole('button', { name: 'Next: Schedule', exact: true }).click();
  await wizard.getByRole('button', { name: 'Add Milestone', exact: true }).click();
  const milestone = page.getByRole('dialog', { name: 'Milestone', exact: true });
  await milestone.getByLabel('Name', { exact: true }).fill('Design review');
  await milestone.getByRole('button', { name: 'Save', exact: true }).click();
  await wizard.getByRole('button', { name: 'Next: Project Structure', exact: true }).click();
  await wizard.getByRole('button', { name: 'Next: Review', exact: true }).click();
  await wizard.getByRole('button', { name: 'Create Project', exact: true }).click();
  await page.waitForURL(/\/v4\/projects\/[\da-f-]+\/summary/, { timeout: 30000 });
  const projectId = new URL(page.url()).pathname.split('/')[3];
  const project = await (await page.request.get(`${origin}/api/projects/${projectId}`)).json();
  assert.equal(project.data.projectName, 'Electron Final V4 Verification');
  assert.equal(project.data.priority, 'Low');
  assert.equal(project.data.finalSetup.schedule.milestones[0].name, 'Design review');
  evidence.createdProject = {
    id: projectId,
    code: project.data.projectCode,
    finalSetup: project.data.finalSetup,
  };
  await page.reload();
  await page
    .getByRole('region', { name: 'Project metadata', exact: true })
    .getByText('Electron Final V4 Verification', { exact: true })
    .waitFor();
  await page.screenshot({ path: path.join(output, 'created-project.png') });
  await page.goto(`${origin}/v4/projects/${projectId}/comments`);
  await page.getByRole('button', { name: 'Add Comment', exact: true }).click();
  const commentEditor = page.getByRole('dialog', { name: 'Add Comment', exact: true });
  await commentEditor.getByLabel('Title', { exact: true }).fill('Electron persisted discussion');
  await commentEditor
    .getByLabel('Description', { exact: true })
    .fill('Actual discussion created through the final UI.');
  await commentEditor.getByRole('button', { name: 'Add Comment', exact: true }).click();
  const thread = page.getByRole('article', { name: 'Electron persisted discussion', exact: true });
  await thread
    .getByRole('textbox', { name: 'Reply to Electron persisted discussion', exact: true })
    .fill('Electron persisted reply');
  await thread.getByRole('button', { name: 'Send reply', exact: true }).click();
  await thread.getByText('Electron persisted reply', { exact: true }).waitFor();
  await thread.getByRole('button', { name: 'Resolve', exact: true }).click();
  await thread.getByRole('button', { name: 'Reopen', exact: true }).waitFor();
  await page.reload();
  await thread.getByText('Electron persisted reply', { exact: true }).waitFor();
  await thread.getByRole('button', { name: 'Reopen', exact: true }).waitFor();
  const commentWorkspace = await (
    await page.request.get(`${origin}/api/projects/${projectId}/workspace`)
  ).json();
  const persistedThread = commentWorkspace.data.reviewItems.find(
    (item) => item.title === 'Electron persisted discussion',
  );
  assert.equal(persistedThread.status, 'Resolved');
  assert.equal(persistedThread.projectId, projectId);
  evidence.comments = {
    threadId: persistedThread.id,
    status: persistedThread.status,
    replySurvivedReload: true,
  };
  await page.goto(`${origin}/v4/projects/${projectId}/meetings`);
  await page.getByRole('button', { name: 'Add Meeting', exact: true }).click();
  const meetingEditor = page.getByRole('dialog', { name: 'Add Meeting', exact: true });
  await meetingEditor.getByLabel('Title', { exact: true }).fill('Electron persisted coordination');
  await meetingEditor.getByLabel('Date', { exact: true }).fill('2099-09-29');
  await meetingEditor.getByLabel('Start Time', { exact: true }).fill('10:00');
  await meetingEditor.getByRole('button', { name: 'Add Meeting', exact: true }).click();
  await page
    .getByRole('region', { name: 'Electron persisted coordination', exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole('region', { name: 'Meeting details', exact: true })
    .getByText('Electron persisted coordination', { exact: true })
    .waitFor();
  const meetings = await (
    await page.request.get(`${origin}/api/projects/${projectId}/meetings`)
  ).json();
  assert.equal(meetings.data.length, 1);
  assert.equal(meetings.data[0].title, 'Electron persisted coordination');
  assert.equal(meetings.data[0].startAt, '2099-09-29T06:00:00.000Z');
  evidence.meetings = { meetingId: meetings.data[0].id, persistedStart: meetings.data[0].startAt };
  await page.goto(`${origin}/v4/projects/${projectId}/contacts`);
  await page.getByRole('button', { name: 'Add Contact', exact: true }).click();
  const contactEditor = page.getByRole('dialog', { name: 'Add Contact', exact: true });
  await contactEditor.getByLabel('Full name *', { exact: true }).fill('Electron Real Contact');
  await contactEditor.getByLabel('Email *', { exact: true }).fill('electron@example.test');
  await contactEditor.getByLabel('Phone', { exact: true }).fill('+971 50 123 4567');
  await contactEditor.getByLabel('Primary contact', { exact: true }).check();
  await contactEditor.getByRole('button', { name: 'Add Contact', exact: true }).click();
  await page.getByText('Electron Real Contact', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('+971 50 123 4567', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.scliDesktop?.openContactLink), 'function');
  await page.goto(`${origin}/v4/projects/${projectId}/luminaires/advanced`);
  await page.getByRole('button', { name: 'Add Luminaire', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Custom / Project-only', exact: true }).click();
  const luminaireEditor = page.getByRole('dialog', { name: 'Add Luminaire', exact: true });
  await luminaireEditor.getByRole('textbox', { name: /^Tag/ }).fill('EL-01');
  await luminaireEditor
    .getByLabel('Manufacturer', { exact: true })
    .fill('Verification Manufacturer');
  await luminaireEditor.getByLabel('Model', { exact: true }).fill('Actual persisted model');
  await luminaireEditor
    .getByLabel('Description', { exact: true })
    .fill('Disposable verification luminaire');
  await luminaireEditor.getByLabel('Unit', { exact: true }).fill('No.');
  await luminaireEditor.getByLabel('Quantity', { exact: true }).fill('2');
  await luminaireEditor.getByLabel('Power', { exact: true }).fill('10');
  await luminaireEditor.getByLabel('Luminous Flux', { exact: true }).fill('1000');
  await luminaireEditor.getByRole('button', { name: 'Save Luminaire', exact: true }).click();
  await page.getByRole('button', { name: 'EL-01', exact: true }).waitFor();
  const populatedWorkspace = await (
    await page.request.get(`${origin}/api/projects/${projectId}/workspace`)
  ).json();
  const luminaire = populatedWorkspace.data.luminaires.find((item) => item.tag === 'EL-01');
  const contact = populatedWorkspace.data.contacts.find(
    (item) => item.name === 'Electron Real Contact',
  );
  assert.equal(contact.phone, '+971 50 123 4567');
  assert.equal(contact.isPrimary, true);
  assert.equal(luminaire.model, 'Actual persisted model');
  await page.goto(`${origin}/v4/projects/${projectId}/actions`);
  await page.getByRole('button', { name: 'Add Action', exact: true }).click();
  const actionEditor = page.getByRole('dialog', { name: 'Add Action', exact: true });
  await actionEditor.getByLabel('Title', { exact: true }).fill('Electron linked action');
  await actionEditor.getByLabel('Area', { exact: true }).fill('Actual project area');
  await actionEditor.getByLabel('Linked luminaire', { exact: true }).selectOption(luminaire.id);
  await actionEditor.getByLabel('Linked comment', { exact: true }).selectOption(persistedThread.id);
  await actionEditor.getByRole('button', { name: 'Add action', exact: true }).click();
  await page.getByRole('button', { name: 'Electron linked action', exact: true }).click();
  await page.getByRole('button', { name: 'Mark Complete', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen Action', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Electron linked action', exact: true }).click();
  await page.getByRole('button', { name: 'Reopen Action', exact: true }).waitFor();
  const filterGeometry = await page
    .getByRole('button', { name: 'Status', exact: true })
    .evaluate((status) => ({
      status: status.getBoundingClientRect().y,
      owner: document.querySelector('button[aria-label="Owner"]').getBoundingClientRect().y,
    }));
  assert.ok(
    Math.abs(filterGeometry.status - filterGeometry.owner) < 1,
    'Final Action filters must share the reference toolbar row at the wide viewport.',
  );
  const savedWorkspace = await (
    await page.request.get(`${origin}/api/projects/${projectId}/workspace`)
  ).json();
  const savedAction = savedWorkspace.data.actions.find(
    (item) => item.title === 'Electron linked action',
  );
  assert.equal(savedAction.status, 'Completed');
  assert.equal(savedAction.luminaireId, luminaire.id);
  assert.equal(savedAction.reviewItemId, persistedThread.id);
  assert.equal(savedAction.rowVersion, 2);
  evidence.contacts = { id: contact.id, phonePersisted: true, primaryPersisted: true };
  evidence.luminaires = { id: luminaire.id, tag: luminaire.tag };
  evidence.actions = {
    id: savedAction.id,
    rowVersion: savedAction.rowVersion,
    linkedLuminaireId: savedAction.luminaireId,
    linkedCommentId: savedAction.reviewItemId,
    status: savedAction.status,
  };
  await page.goto(`${origin}/v4/projects/${projectId}/technical-check`);
  const [batchResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/local-intelligence/analyze-datasheets') &&
        response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Run Technical Check', exact: true }).click(),
  ]);
  assert.equal(batchResponse.ok(), true, await batchResponse.text());
  const batch = (await batchResponse.json()).data;
  await page.reload();
  await page.getByRole('button', { name: 'EL-01: Datasheet Analysis', exact: true }).waitFor();
  const restored = (
    await (
      await page.request.get(
        `${origin}/api/projects/${projectId}/local-intelligence/datasheet-results`,
      )
    ).json()
  ).data;
  assert.deepEqual(restored.summary, batch.summary);
  assert.equal(restored.items[0].luminaireId, luminaire.id);
  evidence.technicalCheck = { restoredAfterReload: true, summary: restored.summary };
  evidence.studioExports = [];
  for (const kind of ['schedule', 'boq', 'datasheets']) {
    for (const format of ['PDF', 'XLSX']) {
      const studioState = (
        await (
          await page.request.get(`${origin}/api/projects/${projectId}/luminaire-studio`)
        ).json()
      ).data;
      const response = await page.request.post(
        `${origin}/api/projects/${projectId}/luminaire-studio/outputs`,
        {
          data: {
            version: studioState.version,
            baseFingerprint: studioState.fingerprint,
            operationId: crypto.randomUUID(),
            kind,
            format,
            selection: [],
            separate: false,
          },
          timeout: 120000,
        },
      );
      assert.equal(response.status(), 201, await response.text());
      const result = (await response.json()).data;
      for (const artifact of result.artifacts) {
        const downloaded = await page.request.get(`${origin}${artifact.url}`);
        assert.equal(downloaded.status(), 200);
        const bytes = await downloaded.body();
        assert.ok(bytes.length > 100);
        assert.equal(
          bytes.subarray(0, format === 'PDF' ? 4 : 2).toString(),
          format === 'PDF' ? '%PDF' : 'PK',
        );
      }
      evidence.studioExports.push({
        kind,
        format,
        revisionId: result.revisionId,
        artifacts: result.artifacts,
      });
    }
  }
  await page.goto(`${origin}/v4/projects/${projectId}/revisions`);
  await page.getByRole('button', { name: 'New Revision', exact: true }).click();
  const revisionEditor = page.getByRole('dialog', { name: 'Create Revision', exact: true });
  await revisionEditor.getByLabel(/Revision Purpose/).fill('Electron canonical revision');
  await revisionEditor.getByRole('button', { name: 'Create Revision', exact: true }).click();
  await revisionEditor.waitFor({ state: 'hidden' });
  await page.reload();
  const revisions = (
    await (await page.request.get(`${origin}/api/projects/${projectId}/revisions`)).json()
  ).data;
  const createdRevision = revisions.find((item) => item.purpose === 'Electron canonical revision');
  assert.ok(createdRevision);
  assert.equal(createdRevision.projectId, projectId);
  assert.equal(createdRevision.lifecycleState, 'PREPARING');
  await page
    .getByRole('button', { name: `Select Revision ${createdRevision.revisionLabel}`, exact: true })
    .click();
  evidence.revisions = {
    id: createdRevision.revisionId,
    label: createdRevision.revisionLabel,
    restoredAfterReload: true,
  };
  await page.getByRole('button', { name: 'Work Session', exact: true }).click();
  const sessionTray = page.getByRole('dialog', { name: 'Work Session', exact: true });
  await sessionTray.getByRole('button', { name: 'Start Session', exact: true }).click();
  await sessionTray.getByRole('button', { name: 'Pause', exact: true }).click();
  await sessionTray.getByRole('button', { name: 'Resume', exact: true }).waitFor();
  const pausedSession = (
    await (await page.request.get(`${origin}/api/personal/work-sessions/active`)).json()
  ).data;
  assert.equal(pausedSession.projectId, projectId);
  assert.ok(pausedSession.pausedAt);
  await page.reload();
  await page.getByRole('button', { name: 'Work Session', exact: true }).click();
  await sessionTray.getByRole('button', { name: 'Resume', exact: true }).click();
  await sessionTray.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  await sessionTray.getByRole('button', { name: 'Stop', exact: true }).click();
  await sessionTray.getByRole('button', { name: 'Start Session', exact: true }).waitFor();
  const sessionHistory = (
    await (
      await page.request.get(`${origin}/api/personal/projects/${projectId}/work-sessions`)
    ).json()
  ).data;
  assert.ok(sessionHistory.find((item) => item.id === pausedSession.id)?.endedAt);
  evidence.workSession = {
    id: pausedSession.id,
    projectId,
    pauseSurvivedReload: true,
    stoppedPersisted: true,
  };
  await sessionTray.getByRole('button', { name: 'Close Work Session', exact: true }).click();
  evidence.generatedOutputs = [];
  for (const [route, title] of [
    ['luminaire-schedule', 'Technical Luminaire Schedule Preview'],
    ['technical-boq', 'Technical Lighting BOQ Preview'],
  ]) {
    await page.goto(
      `${origin}/v4/projects/${projectId}/${route}?targetRevisionId=${createdRevision.revisionId}`,
    );
    await page.getByRole('button', { name: 'Generate Output', exact: true }).click();
    const preview = page.getByRole('dialog', { name: title, exact: true });
    await preview.waitFor();
    const [generatedResponse] = await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith('/output-presentations/generate') &&
          response.request().method() === 'POST',
      ),
      preview.getByRole('button', { name: 'Generate PDF', exact: true }).click(),
    ]);
    assert.equal(generatedResponse.ok(), true, await generatedResponse.text());
    evidence.generatedOutputs.push({ route, response: (await generatedResponse.json()).data });
    await preview.getByRole('button', { name: 'Generated', exact: true }).waitFor();
    await preview.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
  }
  await page.goto(`${origin}/v4/projects/${projectId}/revisions`);
  await page
    .getByRole('button', {
      name: `View Revision details for ${createdRevision.revisionLabel}`,
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Finalize Revision', exact: true }).click();
  await page.waitForResponse(
    (response) => response.url().includes('/revisions') && response.request().method() === 'GET',
  );
  await page.goto(`${origin}/v4/projects/${projectId}/packages`);
  await page.getByRole('button', { name: 'Create Draft Package', exact: true }).click();
  const packageBuilder = page.getByRole('dialog', { name: 'Package Builder', exact: true });
  await packageBuilder.getByLabel('Label', { exact: true }).fill('Electron verified issue');
  await packageBuilder
    .getByLabel('Warning Override Reason', { exact: true })
    .fill('Disposable verification only; missing Datasheet is acknowledged.');
  const [issuedResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/revision-packages') && response.request().method() === 'POST',
    ),
    packageBuilder.getByRole('button', { name: 'Issue Package', exact: true }).click(),
  ]);
  assert.equal(issuedResponse.ok(), true, await issuedResponse.text());
  const issued = (await issuedResponse.json()).data;
  assert.equal(issued.status, 'Issued');
  assert.ok(issued.id);
  evidence.issuedPackage = issued;
  await page.reload();
  await page
    .getByRole('button', { name: 'Inspect package Electron verified issue', exact: true })
    .waitFor();
  const issueCatalog = (
    await (
      await page.request.get(`${origin}/api/projects/${projectId}/revision-package-catalog`)
    ).json()
  ).data;
  assert.ok(
    issueCatalog.items.filter((item) => item.available).every((item) => item.sizeBytes > 0),
  );
  evidence.issuedPackageSurvivedReload = true;
  for (const size of [
    { width: 1366, height: 900 },
    { width: 1920, height: 1080 },
    { width: 2400, height: 1440 },
  ]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.unmaximize();
      window.setContentSize(size.width, size.height);
    }, size);
    for (const route of [
      'summary',
      'workflow-timeline',
      'scope',
      'actions',
      'meetings',
      'comments',
      'contacts',
      'luminaires',
      'lighting-systems',
      'system-accessories',
      'output-studio',
      'studio-datasheets',
      'datasheets-images',
      'technical-check',
      'luminaire-schedule',
      'technical-boq',
      'revisions',
      'packages',
      'files',
      'intelligence',
    ]) {
      await page.goto(`${origin}/v4/projects/${projectId}/${route}`);
      await page
        .getByRole('region', { name: 'Project metadata', exact: true })
        .getByText('Electron Final V4 Verification', { exact: true })
        .waitFor();
      await page.waitForLoadState('networkidle');
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.allSettled(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map((animation) => animation.finished),
        );
      });
      const studioHeadings = {
        luminaires: 'Luminaires',
        'lighting-systems': 'Lighting systems',
        'system-accessories': 'System accessories',
        'output-studio': 'Output studio',
        'studio-datasheets': 'Datasheets',
        'luminaire-schedule': 'Output studio',
        'technical-boq': 'Output studio',
      };
      if (studioHeadings[route]) {
        const studio = page.frameLocator('iframe[title="Luminaire Studio 1.4.1"]');
        await studio.getByRole('heading', { name: studioHeadings[route], exact: true }).waitFor();
        const bounds = await studio
          .locator('html')
          .evaluate((node) => ({ width: innerWidth, scrollWidth: node.scrollWidth }));
        assert.ok(
          bounds.scrollWidth <= bounds.width + 1,
          `${route} Studio content must fit its frame`,
        );
        if (route === 'luminaires') {
          const served = await page.request.get(`${origin}/v4/studio/app.js`);
          assert.equal(served.status(), 200);
          assert.equal(
            createHash('sha256')
              .update(await served.body())
              .digest('hex'),
            createHash('sha256')
              .update(await readFile(path.join(repositoryRoot, 'apps/web-v4/dist/studio/app.js')))
              .digest('hex'),
          );
        }
      }
      if (route === 'packages') {
        const actionBounds = await page
          .getByRole('button', { name: 'Reissue (Create New Package)', exact: true })
          .boundingBox();
        const healthBounds = await page
          .getByText('9. Package Health Checks', { exact: true })
          .boundingBox();
        assert.ok(
          actionBounds && healthBounds && actionBounds.y + actionBounds.height <= healthBounds.y,
          'Package Actions must not overlap Health Checks at compact window sizes.',
        );
      }
      await page.screenshot({
        path: path.join(output, `project-${route}-${size.width}x${size.height}.png`),
      });
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        panels: [...document.querySelectorAll('.final-ui-reference')].map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            transform: getComputedStyle(node).transform,
          };
        }),
      }));
      assert.ok(geometry.scrollWidth <= geometry.width + 1, `${route} must fit the window width`);
      assert.ok(
        geometry.panels.every(
          (panel) => panel.transform === 'none' || panel.transform === 'matrix(1, 0, 0, 1, 0, 0)',
        ),
        `${route} must not scale the page`,
      );
      evidence.routes.push({
        route: `projects/${projectId}/${route}`,
        url: page.url(),
        size,
        geometry,
      });
    }
  }
  assert.equal(evidence.rendererErrors.length, 0, evidence.rendererErrors.join('\n'));
  if (packagedExecutable) {
    await app.close();
    app = await electron.launch({
      executablePath: packagedExecutable,
      args: [`--user-data-dir=${path.join(temporaryRoot, 'profile')}`],
      env,
      timeout: 60000,
    });
    const reopened = await app.firstWindow({ timeout: 60000 });
    await reopened.waitForURL(/\/v4\//, { timeout: 60000 });
    const reopenedOrigin = new URL(reopened.url()).origin;
    const persisted = await reopened.request.get(`${reopenedOrigin}/api/projects/${projectId}`);
    assert.equal(persisted.status(), 200);
    assert.equal((await persisted.json()).data.id, projectId);
    for (const generated of evidence.studioExports) {
      for (const artifact of generated.artifacts) {
        const download = await reopened.request.get(`${reopenedOrigin}${artifact.url}`);
        assert.equal(download.status(), 200);
      }
    }
    evidence.restart = { projectId, persisted: true, studioArtifactsAccessible: true };
  }
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.failure = String(error?.stack || error);
  if (app) {
    try {
      const failedPage = await app.firstWindow();
      await failedPage.screenshot({ path: path.join(output, 'failure.png') });
      await writeFile(
        path.join(output, 'failure-dom.txt'),
        await failedPage.locator('body').innerText(),
      );
    } catch {
      /* Preserve the original failure even if the window has already closed. */
    }
  }
  process.exitCode = 1;
} finally {
  if (app)
    await app.close().catch((error) => {
      evidence.shutdownError = String(error);
    });
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'electron-validation.json'), JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({
      status: evidence.status,
      failure: evidence.failure,
      evidence: path.join(output, 'electron-validation.json'),
    }),
  );
}
