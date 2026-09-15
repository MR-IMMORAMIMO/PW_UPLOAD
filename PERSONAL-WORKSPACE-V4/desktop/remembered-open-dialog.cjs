'use strict';
const path = require('node:path');
const fs = require('node:fs');
/** Wrap only the native open picker; retain a directory after a successful selection. */
function rememberedOpenDialog(dialog, statePath) {
  let directory;
  let saveDirectory;
  let loaded = false;
  const file = () => (typeof statePath === 'function' ? statePath() : statePath);
  function load() {
    if (loaded) return;
    loaded = true;
    try {
      const state = JSON.parse(fs.readFileSync(file(), 'utf8'));
      directory = state.open;
      saveDirectory = state.save;
    } catch {
      /* A missing preference must never prevent opening a picker. */
    }
  }
  function usable(value) {
    return (
      typeof value === 'string' && path.isAbsolute(value) && (!statePath || fs.existsSync(value))
    );
  }
  function persist() {
    if (!statePath) return;
    try {
      const target = file();
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(`${target}.tmp`, JSON.stringify({ open: directory, save: saveDirectory }));
      fs.renameSync(`${target}.tmp`, target);
    } catch {
      /* Preference failure must not turn a successful file selection into failure. */
    }
  }
  return {
    showOpenDialog: async (parent, options) => {
      load();
      const result = await dialog.showOpenDialog(parent, {
        ...(usable(directory) ? { defaultPath: directory } : {}),
        ...options,
      });
      const selected = result?.filePaths?.[0];
      if (!result?.canceled && typeof selected === 'string' && path.isAbsolute(selected)) {
        directory = options.properties?.includes('openDirectory')
          ? selected
          : path.dirname(selected);
        persist();
      }
      return result;
    },
    showSaveDialog: async (parent, options) => {
      load();
      const defaultPath = options.defaultPath;
      const result = await dialog.showSaveDialog(parent, {
        ...options,
        ...(usable(saveDirectory) && (!defaultPath || !path.isAbsolute(defaultPath))
          ? { defaultPath: path.join(saveDirectory, defaultPath || '') }
          : {}),
      });
      if (
        !result?.canceled &&
        typeof result?.filePath === 'string' &&
        path.isAbsolute(result.filePath)
      ) {
        saveDirectory = path.dirname(result.filePath);
        persist();
      }
      return result;
    },
  };
}
module.exports = { rememberedOpenDialog };
