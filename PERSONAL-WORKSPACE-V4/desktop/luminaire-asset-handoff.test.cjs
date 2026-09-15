const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { executeDesktopHandoff } = require('./external-application-bridge.cjs');

test('bounded asset open/copy validates bytes, rejects replay and preserves source and existing copies', async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sct-asset-copy-'));
  const root = path.join(fixture, 'data');
  fs.mkdirSync(root);
  const pending = path.join(root, 'desktop-handoffs', 'pending');
  fs.mkdirSync(pending, { recursive: true });
  const source = path.join(root, 'original.pdf');
  fs.writeFileSync(source, '%PDF immutable');
  const output = path.join(fixture, 'copy.pdf');
  const issue = (action) => {
    const handoffId = randomUUID();
    fs.writeFileSync(
      path.join(pending, handoffId + '.json'),
      JSON.stringify({
        schemaVersion: 1,
        handoffId,
        action,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        payload: {
          action,
          projectId: randomUUID(),
          assetVersionId: randomUUID(),
          managed: true,
          authorizedProjectRoot: root,
          targetPath: source,
          fileName: 'original.pdf',
          fileHash: createHash('sha256').update('%PDF immutable').digest('hex'),
        },
      }),
    );
    return { handoffId, expectedAction: action };
  };
  try {
    let opened;
    const open = issue('OPEN_LUMINAIRE_ASSET');
    assert.equal(
      (
        await executeDesktopHandoff(open, root, {
          openPath: async (p) => {
            opened = p;
            return '';
          },
        })
      ).opened,
      true,
    );
    assert.equal(opened, source);
    const libraryOpen = issue('OPEN_LIBRARY_ASSET');
    assert.equal(
      (await executeDesktopHandoff(libraryOpen, root, { openPath: async () => '' })).opened,
      true,
    );
    const packageOpen = issue('OPEN_PACKAGE_DELIVERABLE');
    assert.equal(
      (
        await executeDesktopHandoff(packageOpen, root, {
          openPath: async (p) => {
            assert.equal(p, source);
            return '';
          },
        })
      ).opened,
      true,
    );
    await assert.rejects(executeDesktopHandoff(packageOpen, root, {}));
    await assert.rejects(executeDesktopHandoff(open, root, {}));
    assert.equal(
      (
        await executeDesktopHandoff(issue('SAVE_LUMINAIRE_ASSET_COPY'), root, {
          saveFile: async () => output,
        })
      ).saved,
      true,
    );
    assert.equal(fs.readFileSync(output, 'utf8'), '%PDF immutable');
    await assert.rejects(
      executeDesktopHandoff(issue('SAVE_LUMINAIRE_ASSET_COPY'), root, {
        saveFile: async () => source,
      }),
    );
    await assert.rejects(
      executeDesktopHandoff(issue('SAVE_LUMINAIRE_ASSET_COPY'), root, {
        saveFile: async () => output,
      }),
    );
    assert.equal(fs.readFileSync(source, 'utf8'), '%PDF immutable');
    fs.writeFileSync(source, 'modified');
    await assert.rejects(
      executeDesktopHandoff(issue('OPEN_LUMINAIRE_ASSET'), root, { openPath: async () => '' }),
      /no longer matches/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
