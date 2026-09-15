'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');

const LUMINAIRE_ASSET_PICKER_CHANNEL = 'scli:select-luminaire-asset-file';

const pickerPolicy = Object.freeze({
  Datasheet: Object.freeze({
    title: 'Select Luminaire Datasheet PDF',
    filterName: 'PDF Datasheet',
    extensions: Object.freeze(['pdf']),
  }),
  ProductImage: Object.freeze({
    title: 'Select Luminaire Product Image',
    filterName: 'Product Image',
    extensions: Object.freeze(['png', 'jpg', 'jpeg', 'webp']),
  }),
});

function policyFor(assetType) {
  const policy =
    typeof assetType === 'string' && Object.hasOwn(pickerPolicy, assetType)
      ? pickerPolicy[assetType]
      : null;
  if (!policy) throw new Error('Unsupported Luminaire asset picker action.');
  return policy;
}

async function pickLuminaireAssetFile(dialog, parentWindow, assetType) {
  const policy = policyFor(assetType);
  const result = await dialog.showOpenDialog(parentWindow, {
    title: policy.title,
    properties: ['openFile'],
    filters: [{ name: policy.filterName, extensions: [...policy.extensions] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const extension = path.extname(filePath).slice(1).toLocaleLowerCase('en');
  if (!path.isAbsolute(filePath) || !policy.extensions.includes(extension)) {
    throw new Error('The selected file does not match the requested Luminaire asset type.');
  }
  return { assetType, fileName: path.basename(filePath), filePath };
}

function registerLuminaireAssetPicker(ipcMain, dialog, getParentWindow) {
  ipcMain.handle(LUMINAIRE_ASSET_PICKER_CHANNEL, (_event, assetType) =>
    pickLuminaireAssetFile(dialog, getParentWindow(), assetType),
  );
  // Read only the file chosen in this dialog; the renderer cannot supply a path.
  ipcMain.handle('scli:select-studio-asset', async (_event, assetType) => {
    const selected = await pickLuminaireAssetFile(dialog, getParentWindow(), assetType);
    if (!selected) return null;
    const info = await fs.lstat(selected.filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 10 * 1024 * 1024)
      throw new Error('Choose a regular file smaller than 10 MB.');
    const bytes = await fs.readFile(selected.filePath);
    const ext = path.extname(selected.filePath).toLowerCase();
    const mime = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
    }[ext];
    return { fileName: selected.fileName, mime, base64: bytes.toString('base64') };
  });
}

module.exports = {
  LUMINAIRE_ASSET_PICKER_CHANNEL,
  pickerPolicy,
  pickLuminaireAssetFile,
  registerLuminaireAssetPicker,
};
