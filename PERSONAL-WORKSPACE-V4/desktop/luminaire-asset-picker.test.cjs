'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LUMINAIRE_ASSET_PICKER_CHANNEL,
  pickLuminaireAssetFile,
  registerLuminaireAssetPicker,
} = require('./luminaire-asset-picker.cjs');

if (process.env.VITEST && typeof globalThis.test === 'function') {
  globalThis.test('desktop Luminaire asset picker tests are executed with node --test', () => {});
}

test('Datasheet picker is single-file PDF-only and returns a basename for display', async () => {
  let options;
  const result = await pickLuminaireAssetFile(
    {
      async showOpenDialog(_parent, received) {
        options = received;
        return { canceled: false, filePaths: ['C:\\UAT\\DL01 Datasheet.pdf'] };
      },
    },
    {},
    'Datasheet',
  );

  assert.deepEqual(options, {
    title: 'Select Luminaire Datasheet PDF',
    properties: ['openFile'],
    filters: [{ name: 'PDF Datasheet', extensions: ['pdf'] }],
  });
  assert.deepEqual(result, {
    assetType: 'Datasheet',
    fileName: 'DL01 Datasheet.pdf',
    filePath: 'C:\\UAT\\DL01 Datasheet.pdf',
  });
});

test('Product Image picker is bounded to current supported image formats', async () => {
  let options;
  const result = await pickLuminaireAssetFile(
    {
      async showOpenDialog(_parent, received) {
        options = received;
        return { canceled: false, filePaths: ['C:\\UAT\\DL01.webp'] };
      },
    },
    {},
    'ProductImage',
  );

  assert.deepEqual(options.filters, [
    { name: 'Product Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
  ]);
  assert.equal(result.fileName, 'DL01.webp');
});

test('cancel is a normal null result and invalid actions or returned extensions are rejected', async () => {
  const canceled = await pickLuminaireAssetFile(
    { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    {},
    'Datasheet',
  );
  assert.equal(canceled, null);
  await assert.rejects(
    () =>
      pickLuminaireAssetFile(
        { showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\UAT\\bad.exe'] }) },
        {},
        'Datasheet',
      ),
    /does not match/,
  );
  await assert.rejects(
    () => pickLuminaireAssetFile({ showOpenDialog: async () => null }, {}, 'IES'),
    /Unsupported/,
  );
});

test('registration exposes bounded file and Studio pickers', async () => {
  const handlers = new Map();
  const parent = {};
  registerLuminaireAssetPicker(
    {
      handle(channel, received) {
        handlers.set(channel, received);
      },
    },
    { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    () => parent,
  );
  assert.equal(await handlers.get(LUMINAIRE_ASSET_PICKER_CHANNEL)({}, 'Datasheet'), null);
  assert.equal(await handlers.get('scli:select-studio-asset')({}, 'Datasheet'), null);
});
test('Studio returns only the selected supported file and rejects an oversized selection', async () => {
  const fs = require('node:fs/promises'),
    path = require('node:path'),
    os = require('node:os');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sct-studio-picker-'));
  const file = path.join(dir, 'datasheet.pdf');
  await fs.writeFile(file, '%PDF-1.4\nfixture');
  const handlers = new Map();
  registerLuminaireAssetPicker(
    { handle: (key, handler) => handlers.set(key, handler) },
    { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) },
    () => ({}),
  );
  const pick = handlers.get('scli:select-studio-asset');
  const result = await pick({}, 'Datasheet');
  assert.equal(result.fileName, 'datasheet.pdf');
  assert.equal(Buffer.from(result.base64, 'base64').toString(), '%PDF-1.4\nfixture');
  assert.equal(result.filePath, undefined);
  await assert.rejects(() => pick({}, { filePath: file }), /Unsupported/);
  await fs.writeFile(file, Buffer.alloc(10 * 1024 * 1024 + 1));
  await assert.rejects(() => pick({}, 'Datasheet'), /smaller than/);
});
