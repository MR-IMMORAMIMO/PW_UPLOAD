const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app
  .whenReady()
  .then(async () => {
    const request = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
    const source = path.resolve(__dirname, 'luminaire-studio-v1.4.1');
    const scratch = path.dirname(path.resolve(process.argv[2]));
    const allowed = (file) =>
      file === scratch || file.startsWith(scratch + path.sep) || file.startsWith(source + path.sep);
    const isolated = session.fromPartition('studio-render-' + process.pid);
    isolated.webRequest.onBeforeRequest((details, callback) => {
      if (/^(data:|blob:|about:)/.test(details.url)) return callback({ cancel: false });
      try {
        callback({
          cancel: !details.url.startsWith('file:') || !allowed(fileURLToPath(details.url)),
        });
      } catch {
        callback({ cancel: true });
      }
    });
    isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        session: isolated,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const scripts = [
      'vendor/jszip.min.js',
      'fonts.js',
      'core.js',
      'export.js',
      'datasheet.js',
      'datasheet-xlsx.js',
      'page-layout.js',
    ]
      .map((file) => `<script src="${pathToFileURL(path.join(source, file)).href}"></script>`)
      .join('');
    const page = path.join(scratch, 'studio-render.html');
    await fs.writeFile(
      page,
      `<!doctype html><html><head><meta charset="utf-8">${scripts}</head><body></body></html>`,
    );
    await window.loadFile(page);
    const document = JSON.stringify(request.document);
    const ids = JSON.stringify(request.selection);
    if (request.format === 'XLSX') {
      const expression =
        request.kind === 'datasheets'
          ? `LSDatasheet.xlsx(${document},${ids})`
          : `LSExport.xlsx(${document})`;
      const bytes = await window.webContents.executeJavaScript(
        `(async()=>Array.from(await ${expression}))()`,
      );
      await fs.writeFile(request.output, Buffer.from(bytes), { flag: 'wx' });
    } else {
      const expression =
        request.kind === 'datasheets'
          ? `LSDatasheet.html(${document},${ids})`
          : `LSExport.printHTML(${document})`;
      const html = await window.webContents.executeJavaScript(expression);
      await fs.writeFile(page, html.replace('</head>', scripts + '</head>'));
      await window.loadFile(page);
      if (request.kind !== 'datasheets')
        await window.webContents.executeJavaScript(`LSExport.reflow(document,${document})`);
      else
        await window.webContents.executeJavaScript(
          'document.fonts.ready.then(()=>Promise.all([...document.images].map(image=>image.decode().catch(()=>{}))))',
        );
      const bytes = await window.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
      });
      await fs.writeFile(request.output, bytes, { flag: 'wx' });
    }
    window.destroy();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
setTimeout(() => app.exit(2), 90000).unref();
