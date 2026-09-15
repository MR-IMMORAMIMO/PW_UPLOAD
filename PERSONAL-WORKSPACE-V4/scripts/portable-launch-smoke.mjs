import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const [executable, evidenceDirectory, localAiKit] = process.argv.slice(2);
const root = await mkdtemp(path.join(tmpdir(), 'sct-portable-smoke-'));
const copied = path.join(root, path.basename(executable));
await copyFile(executable, copied);
if (localAiKit) {
  await symlink(
    path.join(localAiKit, 'Local AI Models'),
    path.join(root, 'Local AI Models'),
    'junction',
  );
  await symlink(
    path.join(localAiKit, 'Local AI Runtime'),
    path.join(root, 'Local AI Runtime'),
    'junction',
  );
}
await mkdir(evidenceDirectory, { recursive: true });
const expected = JSON.parse(await readFile('apps/web-v4/dist/build-info.json', 'utf8'));
const evidence = { root, executable, runs: [] };
let browser;
try {
  for (let iteration = 0; iteration < 2; iteration++) {
    const server = net.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      copied,
      [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(root, 'profile')}`],
      {
        env: environment,
        windowsHide: true,
        stdio: 'ignore',
      },
    );
    child.on('error', (error) => {
      evidence.launchError = String(error);
    });
    const deadline = Date.now() + 120000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
      } catch {
        /* Extraction is still running. */
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.ok(ready, 'Portable must expose its running Chromium instance after extraction.');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? (await context.waitForEvent('page'));
    await page.waitForURL(/\/v4\//, { timeout: 60000 });
    await page.locator('html[data-sct-build]').waitFor();
    const origin = new URL(page.url()).origin;
    const build = await (await page.request.get(`${origin}/v4/build-info.json`)).json();
    assert.deepEqual(build, expected);
    assert.equal(await page.locator('html').getAttribute('data-sct-build'), expected.sourceSha256);
    const me = await page.request.get(`${origin}/api/me`);
    assert.equal(me.status(), 200);
    if (localAiKit) {
      const status = await page.request.get(`${origin}/api/local-ai/status`);
      assert.equal(status.status(), 200);
      assert.equal((await status.json()).data.ready, true);
    }
    evidence.runs.push({ iteration, url: page.url(), build, identity: await me.json() });
    await page.screenshot({ path: path.join(evidenceDirectory, `portable-${iteration}.png`) });
    const connection = await browser.newBrowserCDPSession();
    // Electron may close the transport before replying to Browser.close.
    await Promise.race([
      connection.send('Browser.close').catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    await browser.close().catch(() => {});
    browser = null;
    await new Promise((resolve, reject) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => reject(new Error('Portable launcher did not exit.')), 30000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  assert.deepEqual(evidence.runs[0].identity.data, evidence.runs[1].identity.data);
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await writeFile(
    path.join(evidenceDirectory, 'portable-launch.json'),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
}
