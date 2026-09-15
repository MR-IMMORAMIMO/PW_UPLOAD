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
  await read(
    '/api/projects/' + created.id + '/revisions/' + draft.revision.revisionId + '/deliverables',
  );
  const builder = page.getByRole('dialog', { name: 'Package Builder', exact: true });

  await page
    .getByRole('button', { name: 'Inspect package Friday saved draft', exact: true })
    .click();
  await builder
    .locator('footer')
    .getByRole('button', { name: 'Preview Contents', exact: true })
    .click();
  const preview = page.getByRole('dialog', { name: 'Issue Package Preview', exact: true });
  await expect(preview).toBeVisible();
  await capture('34-package-preview');
  await preview.getByRole('button', { name: 'Open Snapshot test A.pdf', exact: true }).click();
  const member = page.getByRole('dialog', { name: 'Snapshot test A.pdf', exact: true });
  await expect(member).toBeVisible();
  await page.waitForTimeout(1200);
  await capture('33-package-file');
  results.passed = true;
} catch (error) {
  results.failure = error.stack;
  throw error;
} finally {
  await writeFile(
    path.join(output, 'package-visual-results.json'),
    JSON.stringify(results, null, 2),
  );
  if (app) await app.close();
}
