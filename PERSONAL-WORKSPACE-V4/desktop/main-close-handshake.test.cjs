'use strict';

const { readFileSync } = require('node:fs');
const path = require('node:path');

if (process.env.VITEST && typeof globalThis.test === 'function') {
  globalThis.test('desktop close handshake keeps a bounded renderer decision path', () => {
    const main = readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
    const preload = readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
    globalThis.expect(main).toContain("webContents.send('scli:close-requested')");
    globalThis.expect(main).toContain("ipcMain.on('scli:close-response'");
    globalThis.expect(main).toContain('CLOSE_HANDSHAKE_TIMEOUT_MS');
    globalThis.expect(preload).toContain('onCloseRequested:');
    globalThis.expect(preload).toContain('respondToClose:');
    globalThis.expect(preload).toContain("removeListener('scli:close-requested'");
  });
}
