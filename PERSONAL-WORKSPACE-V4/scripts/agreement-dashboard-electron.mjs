import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const root = process.cwd();
const output = path.join(root, 'output/agreement-recheck-20260912/dashboard-electron');
await mkdir(output, { recursive: true });
const disposable = await mkdtemp(path.join(tmpdir(), 'sct-agreement-dashboard-'));
const profile = path.join(disposable, 'profile');
await mkdir(profile);
await writeFile(
  path.join(disposable, 'package.json'),
  JSON.stringify({ name: 'sct-agreement-check', main: 'launcher.cjs' }),
);
await writeFile(
  path.join(disposable, 'launcher.cjs'),
  `const {app}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.getAppPath=()=>${JSON.stringify(root)};require(${JSON.stringify(path.join(root, 'desktop/main.cjs'))});`,
);
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: disposable };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
const results = { disposable, screenshots: [], checks: [], errors: [] };
let app;
try {
  app = await electron.launch({ args: [disposable], env, timeout: 60000 });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile);
  const page = await app.firstWindow({ timeout: 60000 });
  page.on('pageerror', (e) => results.errors.push(e.message));
  await page.waitForURL(/\/v4\//, { timeout: 60000 });
  const origin = new URL(page.url()).origin;
  await page.locator('html[data-sct-build]').waitFor();
  const build = JSON.parse(
    await readFile(path.join(root, 'apps/web-v4/dist/build-info.json'), 'utf8'),
  );
  assert.equal(await page.locator('html').getAttribute('data-sct-build'), build.sourceSha256);
  results.build = build;
  const post = async (url, data) => {
    const response = await page.request.post(origin + url, { data });
    assert.ok(response.ok(), await response.text());
    return (await response.json()).data;
  };
  const { project } = await post('/api/projects', {
    projectName: 'Agreement Dashboard Project',
    clientName: 'Disposable Client',
    projectType: 'Lighting Layout',
    siteLocation: 'Dubai',
    designStage: 'Concept',
    lightingScope: 'Sequential agreement verification',
    priority: 'Normal',
    complexity: 'Medium',
    estimatedHours: 8,
    requiredDeliveryDate: '2026-09-12',
    createFolders: false,
    idempotencyKey: randomUUID(),
  });
  const capture = async (name) => {
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });
    await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    results.screenshots.push(name + '.png');
  };
  await page.goto(origin + '/v4/dashboard');
  await expect(page.getByRole('button', { name: 'Start Session', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse session banner' })).toBeHidden();
  results.checks.push('m0003-m0007 idle banner hidden and card offers start');
  await capture('01-idle');
  await page.getByRole('button', { name: /Due This Week/ }).click();
  await expect(page).toHaveURL(/projects\?dashboard=dueThisWeek/);
  await expect(page.getByRole('combobox', { name: 'Due Date' })).toHaveValue('This Week');
  await expect(page.getByText('Agreement Dashboard Project', { exact: true })).toBeVisible();
  await capture('02-kpi-projects-filter');
  results.checks.push('m0010-m0011 KPI opens Projects, visible date/status filters include today');
  await page.goto(origin + '/v4/dashboard');
  await page.getByRole('button', { name: 'Blocking Requirements', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Blocking Requirements' })).toBeVisible();
  await capture('03-blocking-group');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View all operations' }).click();
  const operations = page.getByRole('dialog', { name: 'All Operations' });
  await operations.getByRole('button', { name: /Operation group/ }).click();
  await page.getByRole('option', { name: 'Upcoming Meetings', exact: true }).click();
  await expect(operations.getByText('Overdue Actions', { exact: true })).toBeHidden();
  await capture('04-operations-filter');
  results.checks.push('m0016-m0017 group floats and All Operations filtering');
  await page.keyboard.press('Escape');
  await post('/api/personal/work-sessions/start', {
    projectId: project.id,
    idempotencyKey: randomUUID(),
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Collapse session banner' })).toBeVisible();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Work Session Details' });
  await expect(details.getByText('Agreement Dashboard Project')).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  await capture('05-session-details');
  await details.getByRole('button', { name: 'Open Project' }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/summary$`));
  results.checks.push('m0018-m0019 View opens session float; Open Project navigates from it');
  await post('/api/personal/work-sessions/pause', { idempotencyKey: randomUUID() });
  await page.goto(origin + '/v4/dashboard');
  await expect(page.getByRole('button', { name: 'Collapse session banner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(2);
  await post('/api/personal/work-sessions/stop', { idempotencyKey: randomUUID() });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Collapse session banner' })).toBeHidden();
  results.checks.push('m0003-m0005 paused banner retained, stopped banner removed');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('scli.v4.theme', value), theme);
    await page.reload();
    await page.getByRole('button', { name: 'View all attention items' }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'Need Attention' })
        .getByRole('button', { name: /Attention reason/ }),
    ).toBeVisible();
    await capture('06-attention-' + theme);
  }
  await page.goto(origin + '/v4/projects');
  const row = page.getByRole('row').filter({ hasText: 'Agreement Dashboard Project' });
  await row.getByRole('button', { name: 'Favorite project', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Remove favorite', exact: true })).toBeVisible();
  await page.reload();
  await expect(row.getByRole('button', { name: 'Remove favorite', exact: true })).toBeVisible();
  const persistedPreferences = await (
    await page.request.get(origin + '/api/personal/ui-preferences')
  ).json();
  assert.equal(
    persistedPreferences.data.items.find((item) => item.targetId === project.id)?.favorite,
    true,
  );
  await row
    .getByRole('button', { name: 'Actions for Agreement Dashboard Project', exact: true })
    .click();
  const actions = page.getByRole('menu', { name: 'Actions for Agreement Dashboard Project' });
  for (const name of ['Open Project', 'Edit Project', 'Open Folder'])
    await expect(actions.getByRole('menuitem', { name, exact: true })).toBeVisible();
  await capture('07-project-actions-menu');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  const planning = page.getByRole('group', { name: 'Planning projects' });
  await planning.getByRole('button', { name: 'Sort Planning projects' }).click();
  const sortMenu = page.getByRole('menu', { name: 'Sort Planning projects' });
  await expect(sortMenu.getByRole('menuitem', { name: 'Priority' })).toBeVisible();
  await capture('08-board-sort-menu');
  await sortMenu.getByRole('menuitem', { name: 'Name', exact: true }).click();
  await expect(sortMenu).toBeHidden();
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(page.getByText('Agreement Dashboard Project', { exact: true })).toBeVisible();
  results.checks.push(
    'm0028-m0048 Table/Board/Cards, persisted favorite, row menu and native pointer column-sort menu',
  );
  const projectRoot = path.join(disposable, 'Chosen projects');
  await mkdir(projectRoot);
  // A fresh desktop normally supplies a default root. Simulate only the optional
  // missing-root read; the picker IPC, settings PATCH and subsequent reads stay real.
  let missingRootRead = true;
  await page.route('**/api/personal/settings', async (route) => {
    if (route.request().method() === 'GET' && missingRootRead) {
      missingRootRead = false;
      const response = await route.fetch();
      const body = await response.json();
      delete body.data.projectRoot;
      await route.fulfill({ response, json: body });
    } else await route.continue();
  });
  await app.evaluate(({ dialog, shell }, folder) => {
    globalThis.agreementRootCalls = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    shell.openPath = async (target) => {
      globalThis.agreementRootCalls.push(target);
      return '';
    };
  }, projectRoot);
  await page.goto(origin + '/v4/projects');
  await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
  await expect
    .poll(async () => app.evaluate(() => globalThis.agreementRootCalls))
    .toEqual([projectRoot]);
  const savedSettings = await (await page.request.get(origin + '/api/personal/settings')).json();
  assert.equal(savedSettings.data.projectRoot, projectRoot);
  results.checks.push(
    'm0042-m0046 simulated missing-root read → real desktop folder-picker IPC → real settings persistence → shell open request; picker/shell stubbed to avoid OS interaction',
  );
  assert.deepEqual(results.errors, []);
  results.passed = true;
} catch (error) {
  results.failure = error.stack;
  throw error;
} finally {
  await writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  await app?.close();
}
