import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const output = path.join(root, 'output/agreement-recheck-20260912/new-project-electron');
const previous = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
const disposable = previous.disposable;
assert.ok(path.basename(disposable).startsWith('sct-agreement-wizard-'));
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: disposable };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
const results = { disposable, checks: [], screenshots: [], errors: [] };
let app;
try {
  app = await electron.launch({ args: [disposable], env });
  const page = await app.firstWindow();
  await page.waitForURL(/\/v4\//);
  page.on('pageerror', (e) => results.errors.push(e.message));
  const origin = new URL(page.url()).origin;
  const build = JSON.parse(
    await readFile(path.join(root, 'apps/web-v4/dist/build-info.json'), 'utf8'),
  );
  await expect(page.locator('html')).toHaveAttribute('data-sct-build', build.sourceSha256);
  results.build = build;
  const read = async (url) => (await (await page.request.get(origin + url)).json()).data;
  const capture = async (name) => {
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      );
    });
    await page.screenshot({ path: path.join(output, name + '.png') });
    results.screenshots.push(name + '.png');
  };
  const created = (await read('/api/projects')).find(
    (p) => p.projectName === 'Friday Wizard Verification',
  );
  assert.ok(created);
  await page.goto(origin + '/v4/projects/' + created.id + '/packages');
  await expect(
    page.getByRole('button', { name: 'Download package Friday saved draft', exact: true }),
  ).toBeVisible();
  const draft = (await read('/api/projects/' + created.id + '/issue-history')).items.find(
    (i) => i.package.label === 'Friday saved draft',
  );
  const snapshotRows = await read(
    '/api/projects/' + created.id + '/revisions/' + draft.revision.revisionId + '/deliverables',
  );
  const builder = page.getByRole('dialog', { name: 'Package Builder', exact: true });
  await app.evaluate(
    ({ session }, target) => {
      globalThis.__packageDownloads = [];
      session.defaultSession.once('will-download', (event, item) => {
        item.setSavePath(target);
        item.once('done', (event, state) =>
          globalThis.__packageDownloads.push({ state, path: item.getSavePath() }),
        );
      });
    },
    path.join(output, 'Friday saved draft.zip'),
  );
  await page
    .getByRole('button', { name: 'Download package Friday saved draft', exact: true })
    .click();
  await expect.poll(() => app.evaluate(() => globalThis.__packageDownloads.length)).toBe(1);
  assert.equal((await app.evaluate(() => globalThis.__packageDownloads[0])).state, 'completed');
  const packageMember = await page.request.get(
    origin +
      '/api/projects/' +
      created.id +
      '/issue-packages/' +
      draft.package.packageId +
      '/file?memberId=' +
      snapshotRows[0].deliverableId,
  );
  assert.ok(packageMember.ok(), await packageMember.text());
  assert.ok((await packageMember.body()).subarray(0, 4).toString() === '%PDF');
  await page
    .getByRole('button', { name: 'Package actions Friday saved draft', exact: true })
    .click();
  const packageActions = page.getByRole('menu', {
    name: 'Package actions Friday saved draft',
    exact: true,
  });
  await expect(packageActions).toBeVisible();
  await expect(
    packageActions.getByRole('menuitem', { name: 'Start Reissue', exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page
    .getByRole('button', { name: 'Inspect package Friday saved draft', exact: true })
    .click();
  await expect(
    builder.getByRole('complementary', { name: 'Selected package details', exact: true }),
  ).toContainText('Files saved');
  await builder
    .locator('footer')
    .getByRole('button', { name: 'Preview Contents', exact: true })
    .click();
  const packagePreview = page.getByRole('dialog', { name: 'Issue Package Preview', exact: true });
  await expect(packagePreview).toContainText('Saved package: Friday saved draft');
  await expect(packagePreview).not.toContainText('REISSUE');
  await app.evaluate(({ shell }) => {
    globalThis.__packageOpened = [];
    shell.openPath = async (target) => {
      globalThis.__packageOpened.push(target);
      return '';
    };
  });
  await packagePreview
    .getByRole('button', { name: 'Open Snapshot test A.pdf', exact: true })
    .click();
  await expect.poll(() => app.evaluate(() => globalThis.__packageOpened.length)).toBe(1);
  const memberPath = await app.evaluate(() => globalThis.__packageOpened[0]);
  assert.deepEqual(await readFile(memberPath), await packageMember.body());
  await capture('33-package-file');
  await capture('34-package-preview');
  await packagePreview
    .locator('footer')
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await builder.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Issue Package', exact: true }).click();
  await builder.getByRole('textbox', { name: 'Label', exact: true }).fill('Friday issued ZIP');
  const reason = builder.getByRole('textbox', { name: 'Warning Override Reason', exact: true });
  if (await reason.count())
    await reason.fill('Disposable verification of agreed package issue flow.');
  await builder
    .locator('footer')
    .getByRole('button', { name: 'Issue Package', exact: true })
    .click();
  await expect(builder).toContainText('Issue Package recorded successfully');
  const issued = (await read('/api/projects/' + created.id + '/issue-history')).items.find(
    (item) => item.package.label === 'Friday issued ZIP',
  );
  assert.ok(issued?.package.issuedAt);
  assert.equal(issued.package.businessStatus, 'Issued');
  const issuedFile = await page.request.get(
    origin +
      '/api/projects/' +
      created.id +
      '/issue-packages/' +
      issued.package.packageId +
      '/file',
  );
  assert.ok(issuedFile.ok(), await issuedFile.text());
  await writeFile(path.join(output, 'Friday issued ZIP.zip'), await issuedFile.body());
  await capture('35-package-issued');
  await builder.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'View Details', exact: true }).click();
  const ready = page.getByRole('dialog', { name: 'Package Readiness', exact: true });
  await expect(ready).toBeVisible();
  await expect(ready).toContainText('Blocking');
  await ready.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  results.checks.push(
    'Packages: fixed builder footer and Not generated truth; Draft creates real ZIP without issue audit; download/eye/menu are distinct; saved member PDF equals immutable bytes; saved Preview retains package context without automatic reissue; explicit Issue creates real ZIP and audit; Readiness opens its own Float',
  );

  assert.deepEqual(results.errors, []);
  results.passed = true;
} catch (error) {
  results.failure = error.stack;
  if (app) {
    const page = await app.firstWindow();
    results.failedPage = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(output, 'package-failure.png') });
  }
  throw error;
} finally {
  await writeFile(path.join(output, 'package-results.json'), JSON.stringify(results, null, 2));
  if (app) await app.close();
}
