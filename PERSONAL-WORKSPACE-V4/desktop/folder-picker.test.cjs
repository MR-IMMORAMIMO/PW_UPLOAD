'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FOLDER_PICKER_CHANNEL, pickFolder, registerFolderPicker } = require('./folder-picker.cjs');

if (process.env.VITEST && typeof globalThis.test === 'function') {
  globalThis.test('desktop folder picker tests are executed with node --test', () => {});
}

test('folder picker uses the production single-directory policy', async () => {
  let options;
  const result = await pickFolder(
    {
      async showOpenDialog(_parent, received) {
        options = received;
        return { canceled: false, filePaths: ['C:\\UAT\\Project Root'] };
      },
    },
    {},
  );

  assert.deepEqual(options, { properties: ['openDirectory', 'createDirectory'] });
  assert.equal(result, 'C:\\UAT\\Project Root');
});

test('folder picker cancellation is a normal null result', async () => {
  const result = await pickFolder(
    { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    {},
  );
  assert.equal(result, null);
});

test('folder picker rejects malformed or non-absolute selections', async () => {
  await assert.rejects(
    () => pickFolder({ showOpenDialog: async () => null }, {}),
    /invalid directory selection/,
  );
  await assert.rejects(
    () =>
      pickFolder(
        { showOpenDialog: async () => ({ canceled: false, filePaths: ['relative-folder'] }) },
        {},
      ),
    /invalid directory selection/,
  );
});

test('registration exposes only the explicit folder-selection IPC action', async () => {
  let registeredChannel;
  let handler;
  const parent = {};
  registerFolderPicker(
    {
      handle(channel, received) {
        registeredChannel = channel;
        handler = received;
      },
    },
    { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    () => parent,
  );

  assert.equal(registeredChannel, FOLDER_PICKER_CHANNEL);
  assert.equal(await handler({}), null);
});
