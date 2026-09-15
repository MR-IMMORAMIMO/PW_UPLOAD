'use strict';

const path = require('node:path');

const FOLDER_PICKER_CHANNEL = 'scli:select-folder';

async function pickFolder(dialog, parentWindow) {
  const result = await dialog.showOpenDialog(parentWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (!result || typeof result !== 'object' || !Array.isArray(result.filePaths)) {
    throw new Error('The folder picker returned an invalid directory selection.');
  }
  if (result.canceled || !result.filePaths[0]) return null;

  const selectedPath = result.filePaths[0];
  if (typeof selectedPath !== 'string' || !path.isAbsolute(selectedPath)) {
    throw new Error('The folder picker returned an invalid directory selection.');
  }
  return selectedPath;
}

function registerFolderPicker(ipcMain, dialog, getParentWindow) {
  ipcMain.handle(FOLDER_PICKER_CHANNEL, () => pickFolder(dialog, getParentWindow()));
}

module.exports = {
  FOLDER_PICKER_CHANNEL,
  pickFolder,
  registerFolderPicker,
};
