import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const ExcelJS = createRequire(new URL('../apps/api/package.json', import.meta.url))('exceljs');
const root = process.cwd(),
  output = path.join(root, 'output/agreement-recheck-20260912/new-project-electron');
const { disposable } = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
assert.ok(path.basename(disposable).startsWith('sct-agreement-wizard-'));
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: disposable };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
let app;
const result = { disposable, screenshots: [], errors: [] };
try {
  app = await electron.launch({ args: [disposable], env });
  const page = await app.firstWindow();
  await page.waitForURL(/\/v4\//);
  const origin = new URL(page.url()).origin;
  page.on('pageerror', (e) => result.errors.push(e.message));
  const get = async (u) => {
    const r = await page.request.get(origin + u);
    assert.ok(r.ok(), await r.text());
    return (await r.json()).data;
  };
  const capture = async (n) => {
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      );
    });
    await page.screenshot({ path: path.join(output, n + '.png') });
    result.screenshots.push(n + '.png');
  };
  await page.goto(origin + '/v4/reports');
  await expect(page.getByRole('heading', { name: 'Current portfolio', exact: true })).toBeVisible();
  const filters = page.getByRole('region', { name: 'Report filters', exact: true });
  await filters
    .getByRole('textbox', { name: 'Search projects', exact: true })
    .fill('Friday Wizard Verification');
  await expect(
    page.getByRole('button', { name: 'All current projects 1', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All current projects 1', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'All current projects', exact: true });
  await expect(details).toContainText('Friday Wizard Verification');
  await details.locator('footer').getByRole('button', { name: 'Close', exact: true }).click();
  await capture('48-report-overview');
  for (const tab of ['Workload', 'Technical', 'Deliverables', 'Follow-up']) {
    await page
      .getByRole('navigation', { name: 'Report sections', exact: true })
      .getByRole('button', { name: tab, exact: true })
      .click();
    await expect(
      page
        .getByRole('link', { name: 'Friday Wizard Verification', exact: true })
        .and(page.locator('a[href$="/summary"]')),
    ).toBeVisible();
    await capture('49-report-' + tab.toLowerCase());
  }
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dubai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const report = await get(
    '/api/personal/reports/activity?from=' +
      date.slice(0, 8) +
      '01&to=' +
      date +
      '&search=Friday%20Wizard%20Verification',
  );
  assert.equal(report.currentProjects.length, 1);
  assert.ok(report.currentProjects[0].revisions >= 1);
  assert.ok(report.currentProjects[0].issuedPackages >= 1);
  assert.ok(report.currentProjects[0].readiness);
  const revisions = await get(
    '/api/projects/' + report.currentProjects[0].projectId + '/revisions',
  );
  const latest = [...revisions].sort((a, b) => b.revisionSequence - a.revisionSequence)[0];
  assert.equal(report.currentProjects[0].readiness.revisionId, latest.revisionId);
  const xlsx = path.join(output, 'Friday filtered report.xlsx'),
    pdf = path.join(output, 'Friday filtered report.pdf');
  await app.evaluate(
    ({ session, dialog }, targets) => {
      globalThis.__reportDownloads = [];
      session.defaultSession.once('will-download', (event, item) => {
        item.setSavePath(targets.xlsx);
        item.once('done', (event, state) => globalThis.__reportDownloads.push(state));
      });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: targets.pdf });
    },
    { xlsx, pdf },
  );
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  await expect.poll(() => app.evaluate(() => globalThis.__reportDownloads)).toEqual(['completed']);
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return (await stat(pdf)).size;
      } catch {
        return 0;
      }
    })
    .toBeGreaterThan(1000);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsx);
  const portfolio = workbook.getWorksheet('Current portfolio');
  assert.equal(portfolio.rowCount, 4);
  assert.equal(portfolio.getCell('B4').value, 'Friday Wizard Verification');
  assert.equal(
    workbook.getWorksheet('Registered delivery').getCell('D4').value,
    report.currentProjects[0].issuedPackages,
  );
  await filters
    .getByRole('textbox', { name: 'Search projects', exact: true })
    .fill('no matching Friday report');
  await page
    .getByRole('navigation', { name: 'Report sections', exact: true })
    .getByRole('button', { name: 'Overview', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'All current projects 0', exact: true }),
  ).toBeVisible();
  const projectId = report.currentProjects[0].projectId;
  await page.goto(origin + '/v4/documents');
  await expect(page).toHaveURL(/\/v4\/projects$/);
  await page.goto(origin + '/v4/projects/' + projectId + '/intelligence');
  await expect(page).toHaveURL(new RegExp('/v4/projects/' + projectId + '/files$'));
  await expect(
    page.getByRole('navigation').getByText('Document Review Center', { exact: true }),
  ).toHaveCount(0);
  result.report = report;
  result.xlsx = xlsx;
  result.pdf = pdf;
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (e) {
  result.failure = e.stack;
  if (app) {
    const page = await app.firstWindow();
    result.page = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(output, 'reports-failure.png') });
  }
  throw e;
} finally {
  await writeFile(path.join(output, 'reports-results.json'), JSON.stringify(result, null, 2));
  if (app) await app.close();
}
