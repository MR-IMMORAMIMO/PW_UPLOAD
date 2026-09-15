'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { rememberedOpenDialog } = require('./remembered-open-dialog.cjs');
test('remembers successful directory but cancellation and explicit defaults do not get overwritten', async () => {
  const selected = path.resolve('test-picker-root', 'sample.pdf');
  const seen = [];
  const results = [
    { canceled: false, filePaths: [selected] },
    { canceled: true, filePaths: [] },
    { canceled: true, filePaths: [] },
  ];
  const picker = rememberedOpenDialog({
    showOpenDialog: async (_parent, options) => {
      seen.push(options);
      return results.shift();
    },
  });
  await picker.showOpenDialog(null, { properties: ['openFile'] });
  await picker.showOpenDialog(null, { properties: ['openFile'] });
  await picker.showOpenDialog(null, { defaultPath: 'explicit', properties: ['openFile'] });
  assert.equal(seen[1].defaultPath, path.dirname(selected));
  assert.equal(seen[2].defaultPath, 'explicit');
});
test('open and save locations survive a new picker instance and unavailable folders fall back', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sct-picker-'));
  const state = path.join(root, 'preferences.json');
  const source = path.join(root, 'source');
  const output = path.join(root, 'output');
  fs.mkdirSync(source);
  fs.mkdirSync(output);
  try {
    const first = rememberedOpenDialog(
      {
        showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(source, 'a.pdf')] }),
        showSaveDialog: async () => ({ canceled: false, filePath: path.join(output, 'b.pdf') }),
      },
      state,
    );
    await first.showOpenDialog(null, { properties: ['openFile'] });
    await first.showSaveDialog(null, { defaultPath: 'b.pdf' });
    const seen = [];
    const reopened = rememberedOpenDialog(
      {
        showOpenDialog: async (_parent, options) => {
          seen.push(options);
          return { canceled: true, filePaths: [] };
        },
        showSaveDialog: async (_parent, options) => {
          seen.push(options);
          return { canceled: true };
        },
      },
      state,
    );
    await reopened.showOpenDialog(null, {});
    await reopened.showSaveDialog(null, { defaultPath: 'next.pdf' });
    assert.equal(seen[0].defaultPath, source);
    assert.equal(seen[1].defaultPath, path.join(output, 'next.pdf'));
    fs.rmdirSync(source);
    await reopened.showOpenDialog(null, {});
    assert.equal(seen[2].defaultPath, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
