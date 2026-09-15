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
const result = { disposable, screenshots: [], errors: [] };
const name = 'Friday Profile Owner',
  email = 'friday.profile@example.test';
let original;
try {
  app = await electron.launch({ args: [disposable], env });
  let page = await app.firstWindow();
  await page.waitForURL(/\/v4\//);
  let origin = new URL(page.url()).origin;
  original = (await (await page.request.get(origin + '/api/personal/profile')).json()).data;
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
  await page.goto(origin + '/v4/settings');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Edit profile details', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'My Profile', exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await expect(dialog.locator('.v4-profile-preview')).toHaveText('FPO');
  await capture('56-profile-initials-dark');
  await dialog.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit profile details', exact: true })).toHaveText(
    name,
  );
  await expect(page.getByRole('button', { name: 'Edit my profile', exact: true })).toHaveText(
    'FPO',
  );
  await page.getByRole('button', { name: 'Edit my profile', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'My Profile', exact: true });
  const avatar = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#008c95';
    x.fillRect(0, 0, 128, 128);
    x.fillStyle = '#fff';
    x.font = 'bold 46px sans-serif';
    x.fillText('F', 47, 80);
    return c.toDataURL('image/png').split(',')[1];
  });
  await dialog.getByLabel('Choose avatar image', { exact: true }).setInputFiles({
    name: 'Friday fixture avatar.png',
    mimeType: 'image/png',
    buffer: Buffer.from(avatar, 'base64'),
  });
  await expect(dialog.getByRole('img', { name: 'Avatar preview' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect(dialog).toBeHidden();
  await capture('57-profile-photo-dark');
  await app.close();
  app = await electron.launch({ args: [disposable], env });
  page = await app.firstWindow();
  await page.waitForURL(/\/v4\//);
  origin = new URL(page.url()).origin;
  page.on('pageerror', (e) => result.errors.push(e.message));
  await expect(page.getByRole('button', { name: 'Edit profile details', exact: true })).toHaveText(
    name,
  );
  await expect(
    page.getByRole('button', { name: 'Edit my profile', exact: true }).locator('img'),
  ).toBeVisible();
  const saved = (await (await page.request.get(origin + '/api/personal/profile')).json()).data;
  assert.equal(saved.email, email);
  assert.ok(saved.photo.startsWith('data:image/webp;base64,'));
  const projects = (await (await page.request.get(origin + '/api/projects')).json()).data;
  const project = projects.find((p) => p.projectName === 'Friday Wizard Verification');
  await page.goto(origin + '/v4/projects/' + project.id + '/summary');
  await expect(page.getByRole('button', { name: 'Edit profile details', exact: true })).toHaveText(
    name,
  );
  await page.getByRole('button', { name: 'Edit profile details', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'My Profile', exact: true });
  await dialog.getByRole('button', { name: 'Use Initials', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save Profile', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Edit my profile', exact: true })).toHaveText(
    'FPO',
  );
  await capture('58-profile-project-sidebar');
  await page.getByRole('button', { name: 'Edit my profile', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'My Profile', exact: true });
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Unsaved name');
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  const dirty = page.getByRole('alertdialog', { name: 'Unsaved profile changes', exact: true });
  await dirty.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
    'Unsaved name',
  );
  await dialog.locator('header').getByRole('button', { name: 'Close', exact: true }).click();
  await dirty.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.request.patch(origin + '/api/personal/profile', { data: original });
  await page.goto(origin + '/v4/settings');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  result.passed = true;
  assert.deepEqual(result.errors, []);
} catch (e) {
  result.failure = e.stack;
  if (app) {
    const page = await app.firstWindow();
    result.page = await page.locator('body').innerText();
    await page.screenshot({ path: path.join(output, 'profile-failure.png') });
  }
  throw e;
} finally {
  await writeFile(path.join(output, 'profile-results.json'), JSON.stringify(result, null, 2));
  if (app) await app.close();
}
