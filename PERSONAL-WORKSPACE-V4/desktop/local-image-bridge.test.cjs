'use strict';

const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readFile, rm, stat, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { MAX_LOCAL_IMAGE_BYTES, readLocalImage } = require('./local-image-bridge.cjs');

if (process.env.VITEST && typeof globalThis.test === 'function') {
  globalThis.test('desktop local-image bridge tests are executed with node --test', () => {});
}

let temporaryDirectory;

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'scli-local-image-'));
});

after(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function fixture(name, bytes) {
  const target = path.join(temporaryDirectory, name);
  await writeFile(target, bytes);
  return target;
}

test('valid PNG and JPG files return browser-safe data URLs without changing the files', async () => {
  const png = await fixture(
    'fixture.png',
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]),
  );
  const jpg = await fixture('fixture.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]));
  const beforePng = { bytes: await readFile(png), metadata: await stat(png) };
  const beforeJpg = { bytes: await readFile(jpg), metadata: await stat(jpg) };

  const pngResult = await readLocalImage(png);
  const jpgResult = await readLocalImage(jpg);

  assert.equal(pngResult.ok, true);
  assert.match(pngResult.src, /^data:image\/png;base64,/);
  assert.equal(jpgResult.ok, true);
  assert.match(jpgResult.src, /^data:image\/jpeg;base64,/);
  assert.deepEqual(await readFile(png), beforePng.bytes);
  assert.deepEqual(await readFile(jpg), beforeJpg.bytes);
  assert.equal((await stat(png)).mtimeMs, beforePng.metadata.mtimeMs);
  assert.equal((await stat(jpg)).mtimeMs, beforeJpg.metadata.mtimeMs);
});

test('unsupported, missing, invalid and oversized files return controlled unavailable results', async () => {
  const unsupported = await fixture('fixture.gif', Buffer.from('GIF89a'));
  const invalid = await fixture('invalid.png', Buffer.from('not a png'));
  const oversized = await fixture('oversized.png', Buffer.alloc(MAX_LOCAL_IMAGE_BYTES + 1));

  assert.deepEqual(await readLocalImage(unsupported), {
    ok: false,
    reason: 'unsupported-format',
  });
  assert.deepEqual(await readLocalImage(path.join(temporaryDirectory, 'missing.png')), {
    ok: false,
    reason: 'missing',
  });
  assert.deepEqual(await readLocalImage(invalid), { ok: false, reason: 'invalid-image' });
  assert.deepEqual(await readLocalImage(oversized), { ok: false, reason: 'oversized' });
  assert.deepEqual(await readLocalImage('relative.png'), { ok: false, reason: 'invalid-path' });
});

test('preload exposes only the named image method and main owns the filesystem read', async () => {
  const preload = await readFile(path.join(__dirname, 'preload.cjs'), 'utf8');
  const main = await readFile(path.join(__dirname, 'main.cjs'), 'utf8');

  assert.match(
    preload,
    /readLocalImage: \(target\) => ipcRenderer\.invoke\('scli:read-local-image', target\)/,
  );
  assert.match(main, /ipcMain\.handle\('scli:read-local-image',[\s\S]*readLocalImage\(target\)/);
  assert.doesNotMatch(preload, /node:fs|readFile/);
});

test('reveal-in-folder bridge is narrow: absolute path only, no arbitrary command execution', async () => {
  const preload = await readFile(path.join(__dirname, 'preload.cjs'), 'utf8');
  const main = await readFile(path.join(__dirname, 'main.cjs'), 'utf8');

  // Preload exposes only the narrow reveal method.
  assert.match(
    preload,
    /revealInFolder: \(target\) => ipcRenderer\.invoke\('scli:reveal-in-folder', target\)/,
  );
  // Main uses shell.showItemInFolder (not shell.exec / child_process spawn).
  assert.match(
    main,
    /ipcMain\.handle\('scli:reveal-in-folder',[\s\S]*shell\.showItemInFolder\(target\)/,
  );
  // The reveal handler block itself must not invoke exec/spawn.
  const revealBlock =
    main.match(/ipcMain\.handle\('scli:reveal-in-folder',[\s\S]*?\n\}\);/)?.[0] ?? '';
  assert.doesNotMatch(revealBlock, /(?:\.exec|\.spawn|execSync|spawnSync|child_process)/);
  // No arbitrary command execution is exposed to the web layer.
  assert.doesNotMatch(preload, /executeCommand|exec\(|spawn/);
});
