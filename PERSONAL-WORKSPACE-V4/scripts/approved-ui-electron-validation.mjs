/* global document, innerWidth, innerHeight */
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
  const created = await page.request.post(`${origin}/api/projects`, {
    data: {
      projectName: 'Packaged acceptance project',
      clientName: 'Disposable client',
      projectType: 'Lighting Layout',
      siteLocation: 'Dubai',
      designStage: 'Concept',
      lightingScope: 'Isolated application verification',
      priority: 'Normal',
      complexity: 'Medium',
      estimatedHours: 8,
      requiredDeliveryDate: '2027-12-01',
      createFolders: false,
      idempotencyKey: crypto.randomUUID(),
    },
  });
  assert.ok(created.ok(), await created.text());
  const projectId = (await created.json()).data.project.id;
  evidence.projectId = projectId;
  const createRecord = async (collection, data) => {
    const response = await page.request.post(`${origin}/api/projects/${projectId}/${collection}`, {
      data,
    });
    assert.ok(response.ok(), `${collection}: ${await response.text()}`);
    return (await response.json()).data;
  };
  evidence.records = {};
  evidence.records.contact = await createRecord('contacts', {
    name: 'Acceptance Client',
    group: 'Client',
    isPrimary: true,
    notes: 'Disposable name-only contact',
  });
  evidence.records.action = await createRecord('actions', {
    title: 'Review acceptance lighting layout',
    details: 'Verify the fixture layout',
    owner: 'Acceptance Client',
    status: 'Open',
    priority: 'High',
    notes: 'Disposable test action',
  });
  evidence.records.meeting = await createRecord('meetings', {
    title: 'Acceptance coordination',
    startAt: '2026-09-15T08:00:00.000Z',
    endAt: '2026-09-15T09:00:00.000Z',
    agenda: 'Review lighting layout',
    participants: [{ name: 'Acceptance Client', role: 'Client', sortOrder: 0 }],
  });
  evidence.records.luminaire = await createRecord('luminaires', {
    tag: 'UAT-DL01',
    manufacturer: 'Acceptance Lighting',
    model: 'Review Downlight',
    orderingCode: 'UAT-001',
    wattage: '12',
    lumens: '1000',
    lightColor: '3000K',
    quantity: 8,
    unit: 'No.',
    description: 'Disposable lighting fixture',
    location: 'Review room',
  });
  const routes = [
    'dashboard',
    'projects',
    'luminaire-library',
    'imports',
    'reports',
    'settings',
    'new',
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
      'luminaire-schedule',
      'technical-boq',
      'lighting-systems',
      'system-accessories',
      'output-studio',
      'studio-datasheets',
      'revisions',
      'packages',
      'files',
    ].map((route) => `projects/${projectId}/${route}`),
  ];
  evidence.overlays = [];
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('scli.v4.theme', value), theme);
    for (const route of routes) {
      await page.goto(`${origin}/v4/${route}`);
      if (route === 'new') await page.getByRole('dialog').waitFor();
      else await page.getByRole('button', { name: 'Edit my profile', exact: true }).waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      assert.equal(await page.locator('.lucide').count(), 0);
      assert.equal(await page.getByText('Page not found', { exact: true }).count(), 0);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        false,
        `Page overflow: ${route}`,
      );
      await page.screenshot({
        animations: 'disabled',
        path: path.join(output, `${theme}-${route.replaceAll('/', '-')}.png`),
      });
      evidence.routes.push({ route, theme });
      const editor = route.endsWith('/actions')
        ? { button: 'Add Action', title: 'Add Action' }
        : route.endsWith('/meetings')
          ? { button: 'Add Meeting', title: 'Add Meeting' }
          : route.endsWith('/output-studio')
            ? {
                button: 'Generate Revision Outputs',
                title: 'Generate Revision Outputs',
                close: 'Close',
              }
            : route.endsWith('/studio-datasheets')
              ? {
                  button: 'Generate Revision Specifications',
                  title: 'Generate Revision Specifications',
                  close: 'Close',
                }
              : null;
      if (editor) {
        await page.getByRole('button', { name: editor.button, exact: true }).click();
        const dialog = page.getByRole('dialog', { name: editor.title, exact: true });
        await dialog.waitFor();
        const box = await dialog.boundingBox();
        const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        assert.ok(
          box &&
            box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= viewport.width + 1 &&
            box.y + box.height <= viewport.height + 1,
          `${editor.title} fits viewport`,
        );
        await page.screenshot({
          animations: 'disabled',
          path: path.join(output, `${theme}-${editor.title.replaceAll(' ', '-')}.png`),
        });
        if (editor.close)
          await dialog
            .locator('footer')
            .getByRole('button', { name: editor.close, exact: true })
            .click();
        else await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        evidence.overlays.push({ title: editor.title, theme });
      }
    }
    await page.getByRole('button', { name: 'Edit my profile', exact: true }).click();
    await page.getByRole('dialog', { name: 'My Profile', exact: true }).waitFor();
    await page.screenshot({
      animations: 'disabled',
      path: path.join(output, `${theme}-profile.png`),
    });
    await page.keyboard.press('Escape');
  }
  assert.equal(evidence.rendererErrors.length, 0);
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.failure = String(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  evidence.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'electron-validation.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, failure: evidence.failure, output }));
}
