import { _electron as electron, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd(),
  output = path.join(root, 'output/agreement-recheck-20260912/new-project-electron');
const { disposable } = JSON.parse(await readFile(path.join(output, 'results.json'), 'utf8'));
assert.ok(path.basename(disposable).startsWith('sct-agreement-wizard-'));
const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: disposable };
delete env.ELECTRON_RUN_AS_NODE;
delete env.SCT_UI_VARIANT;
let app;
const results = { disposable, checks: [], screenshots: [], errors: [] };
try {
  app = await electron.launch({ args: [disposable], env });
  const page = await app.firstWindow();
  await page.waitForURL(/\/v4\//);
  const origin = new URL(page.url()).origin;
  page.on('pageerror', (e) => results.errors.push(e.message));
  const read = async (url) => (await (await page.request.get(origin + url)).json()).data;
  const post = async (url, data) => {
    const r = await page.request.post(origin + url, { data });
    assert.ok(r.ok(), await r.text());
    return (await r.json()).data;
  };
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
  const project = (await read('/api/projects')).find(
    (p) => p.projectName === 'Friday Wizard Verification',
  );
  const base = '/api/projects/' + project.id;
  const workspace = await read(base + '/workspace');
  const source = path.join(workspace.folderPath, 'Friday extra source.dwg');
  await writeFile(source, 'AC1032 disposable registration fixture');
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, source);
  await page.goto(origin + '/v4/projects/' + project.id + '/files');
  await page.getByRole('button', { name: /^Snapshot test A\.pdf Drawing/ }).click();
  await expect(page.getByText('File presence', { exact: true })).toBeVisible();
  const original = workspace.documents.find((d) => d.title === 'Snapshot test A.pdf');
  await page.getByRole('button', { name: 'Add File', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add Working File', exact: true });
  await expect(editor).toBeVisible();
  await editor
    .getByRole('textbox', { name: 'Working file title', exact: true })
    .fill('Friday independent registration');
  await capture('36-working-file-float');
  await editor.getByRole('button', { name: 'Register File', exact: true }).click();
  await expect(editor).toBeHidden();
  const updated = await read(base + '/workspace');
  assert.deepEqual(
    updated.documents.find((d) => d.id === original.id),
    original,
  );
  const sourceDoc = updated.documents.find((d) => d.title === 'Friday independent registration');
  assert.ok(sourceDoc && sourceDoc.id !== original.id);
  await capture('37-working-file-details');
  await page.getByRole('button', { name: 'Output Activity', exact: true }).click();
  await page.getByRole('button', { name: 'Start Tool Session', exact: true }).click();
  const session = page.getByRole('dialog', { name: 'Start Tool Session', exact: true });
  await session.getByLabel('Expected output', { exact: true }).selectOption('DIALUX_REPORT');
  await expect(session).toContainText('No DIALux source');
  await expect(session.getByRole('button', { name: 'Add source file', exact: true })).toBeVisible();
  await expect(
    session.getByRole('button', { name: 'Start and Launch', exact: true }),
  ).toBeDisabled();
  await capture('38-tool-session-float');
  await session.getByRole('button', { name: 'Cancel', exact: true }).click();
  const rev = await post(base + '/revisions/prepare', { purpose: 'Friday AutoCAD PDF capture' });
  const started = await post('/api/personal/projects/' + project.id + '/tool-sessions', {
    application: 'AUTOCAD',
    artifactType: 'CAD_LAYOUT_PDF',
    sourceDocumentId: sourceDoc.id,
    targetRevisionId: rev.revisionId,
  });
  const pdf = await readFile(
    path.join(root, 'output/agreement-recheck-20260912/autocad-print/disposable-layout.pdf'),
  );
  assert.ok(started.toolSession.exportFolder.includes(disposable));
  for (const name of ['save.tmp', 'drawing.dwl', 'drawing.dwl2', 'acad.err'])
    await writeFile(path.join(started.toolSession.exportFolder, name), 'transient');
  await writeFile(path.join(started.toolSession.exportFolder, 'Friday printed layout.pdf'), pdf);
  let rows = [];
  await expect
    .poll(
      async () => {
        rows = (
          await read('/api/personal/projects/' + project.id + '/captures?view=recent&limit=100')
        ).items;
        return rows.some(
          (r) => r.sourceFileName === 'Friday printed layout.pdf' && r.state === 'COMPLETED',
        );
      },
      { timeout: 30000 },
    )
    .toBe(true);
  assert.equal(
    rows.some((r) =>
      ['save.tmp', 'drawing.dwl', 'drawing.dwl2', 'acad.err'].includes(r.sourceFileName),
    ),
    false,
  );
  const record = rows.find((r) => r.sourceFileName === 'Friday printed layout.pdf');
  assert.ok(record.finalProjectRelativeLocator);
  assert.deepEqual(
    await readFile(path.join(workspace.folderPath, record.finalProjectRelativeLocator)),
    pdf,
  );
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  await expect(page.getByText('Friday printed layout.pdf', { exact: true })).toBeVisible();
  await capture('39-autocad-pdf-captured');
  await post(
    '/api/personal/automation-contexts/' + started.toolSession.toolContextId + '/close',
    {},
  );
  results.checks.push(
    'Working File Add with selected record creates new identity and preserves old fields; fitting Float; file presence/name details; no DIALux source explanation and Add source; real AutoCAD-generated PDF captured and filed byte-identically in selected Revision; transient files absent from ledger',
  );
  assert.deepEqual(results.errors, []);
  results.passed = true;
} catch (e) {
  results.failure = e.stack;
  if (app) {
    const page = await app.firstWindow();
    results.page = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(output, 'files-failure.png') });
  }
  throw e;
} finally {
  await writeFile(path.join(output, 'files-results.json'), JSON.stringify(results, null, 2));
  if (app) await app.close();
}
