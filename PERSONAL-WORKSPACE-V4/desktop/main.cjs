const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { rememberedOpenDialog } = require('./remembered-open-dialog.cjs');
const openDialog = rememberedOpenDialog(dialog, () =>
  path.join(app.getPath('userData'), 'picker-directories.json'),
);
const { readLocalImage } = require('./local-image-bridge.cjs');
const { contactLink } = require('./contact-link.cjs');
const { startLocalAiRuntime } = require('./local-ai-runtime.cjs');
const { registerFolderPicker } = require('./folder-picker.cjs');
const { registerLuminaireAssetPicker } = require('./luminaire-asset-picker.cjs');
const { resolveLocalPort } = require('./local-port.cjs');
const {
  configureApplication,
  executeDesktopHandoff,
  launchApplication,
  listApplicationStatus,
  prepareSessionInbox,
} = require('./external-application-bridge.cjs');
const {
  PersonalServerProcess,
  PersonalServerProcessError,
  StartupBlockedError,
  RecoveryRequiredError,
  StartupFailedError,
  StartupTimeoutError,
} = require('./personal-server-process.cjs');

const { resolveUiVariant, shouldLaunchV4, windowUrlForUiVariant } = require('./ui-variant.cjs');

let apiProcess = null;
let personalServer = null;
let mainWindow = null;
let closing = false;
let quitAllowed = false;
let shutdownPromise = null;
let closeHandshake = null;
const CLOSE_HANDSHAKE_TIMEOUT_MS = 2500;

function selectedWorkspaceVariant() {
  try {
    const metadata = require(path.join(app.getAppPath(), 'package.json'));
    if (metadata.scliWorkspaceVariant === 'team-demo') return 'team-demo';
    return metadata.scliWorkspaceVariant === 'team' ? 'team' : 'personal';
  } catch {
    return 'personal';
  }
}

const workspaceVariant = selectedWorkspaceVariant();
const localAiEdition = require(path.join(app.getAppPath(), 'package.json')).scliLocalAi === true;
let localAiRuntime = null;
if (localAiEdition && !process.argv.some((argument) => argument.startsWith('--user-data-dir=')))
  app.setPath('userData', path.join(app.getPath('appData'), 'SCT Workspace Local AI'));
const teamDemo = workspaceVariant === 'team-demo';
const teamWorkspace = workspaceVariant !== 'personal';
// Presentation/UI variant is separate from the workspace/domain variant. It
// selects which renderer the Personal workspace launches (V4 by default;
// legacy remains available explicitly). Non-personal workspaces never use V4.
const uiVariant = resolveUiVariant(process.env.SCT_UI_VARIANT);
const launchV4 = shouldLaunchV4(workspaceVariant, uiVariant);
const appTitle = teamDemo
  ? 'SCLI Original Team Demo'
  : teamWorkspace
    ? 'SCLI Team Workspace'
    : localAiEdition
      ? 'SCT Workspace Local AI'
      : 'SCT Workspace';

function freePort() {
  return resolveLocalPort();
}

async function waitForApi(url, child) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    if (child.exitCode !== null)
      throw new Error('The local workspace service stopped during startup.');
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return;
    } catch {
      // The API may not be accepting connections during its first startup ticks.
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  throw new Error('The local workspace service did not start in time.');
}

function dataRoot() {
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  const portableFolder = teamDemo
    ? 'SCLI Original Team Demo Data'
    : teamWorkspace
      ? 'SCLI Team Workspace Data'
      : localAiEdition
        ? 'SCLI Local AI Data'
        : 'SCLI Workspace Data';
  const installedFolder = teamDemo
    ? 'Original Team Demo Data'
    : teamWorkspace
      ? 'Team Workspace Data'
      : localAiEdition
        ? 'Local AI Data'
        : 'Workspace Data';
  const root = portableDirectory
    ? path.join(portableDirectory, portableFolder)
    : path.join(app.getPath('userData'), installedFolder);
  mkdirSync(root, { recursive: true });
  return root;
}

async function startPersonalServer() {
  if (localAiEdition)
    localAiRuntime = await startLocalAiRuntime(
      process.env.PORTABLE_EXECUTABLE_DIR || app.getAppPath(),
    );
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const root = dataRoot();
  const apiEntry = path.join(app.getAppPath(), 'apps', 'api', 'dist', 'personal-server.js');
  const exporterPath = app.isPackaged
    ? path.join(process.resourcesPath, 'luminaire-exporter', 'SCLI Luminaire Studio.exe')
    : path.join(app.getAppPath(), 'tools', 'luminaire-exporter', 'SCLI Luminaire Studio.exe');
  const server = new PersonalServerProcess({
    command: process.execPath,
    args: [apiEntry],
    cwd: root,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      APP_MODE: 'standalone',
      WORKSPACE_VARIANT: 'personal',
      PERSONAL_AUTO_LOGIN: 'true',
      LOCAL_AI_ENABLED: localAiEdition ? 'true' : 'false',
      LOCAL_AI_PORT: String(localAiRuntime?.port || 0),
      NODE_ENV: 'production',
      PORT: String(port),
      WEB_ORIGIN: url,
      LOG_LEVEL: 'warn',
      STANDALONE_DB_PATH: path.join(root, 'scli-workspace.sqlite'),
      STANDALONE_SESSION_SECRET: 'portable-personal-workspace-local-session-2026',
      STANDALONE_ADMIN_NAME: 'Mohamed',
      STANDALONE_ADMIN_EMAIL: 'designer@scli.local',
      STANDALONE_ADMIN_PASSWORD: 'Portable-Workspace-Local-Only-2026!',
      LUMINAIRE_EXPORTER_PATH: exporterPath,
      SCT_STUDIO_PACKAGED_EXECUTABLE: app.isPackaged ? process.execPath : '',
      SCT_STUDIO_SOURCE_ROOT: app.isPackaged
        ? path.join(process.resourcesPath, 'studio', 'luminaire-studio-v1.4.1')
        : '',
    },
    url,
    requireHealth: true,
    readyTimeoutMs: 30_000,
    shutdownTimeoutMs: 8_000,
    onLog(stream, text) {
      if (stream === 'stderr') console.error(text);
      else console.log(text);
    },
  });
  server.on('unexpected-exit', () => {
    console.error('The local workspace service exited unexpectedly.');
    dialog.showErrorBox(
      appTitle,
      'The local workspace service stopped unexpectedly. The application will now close. Check the application logs for details.',
    );
    void gracefulQuit();
  });
  personalServer = server;
  await server.start();
  return url;
}

async function startTeamApi() {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const root = dataRoot();
  const apiEntry = path.join(
    app.getAppPath(),
    'apps',
    'api',
    'dist',
    teamDemo ? 'team-demo-server.js' : 'team-server.js',
  );
  const exporterPath = app.isPackaged
    ? path.join(process.resourcesPath, 'luminaire-exporter', 'SCLI Luminaire Studio.exe')
    : path.join(app.getAppPath(), 'tools', 'luminaire-exporter', 'SCLI Luminaire Studio.exe');
  apiProcess = spawn(process.execPath, [apiEntry], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      APP_MODE: teamDemo ? 'mock' : 'standalone',
      WORKSPACE_VARIANT: 'team',
      PERSONAL_AUTO_LOGIN: 'false',
      NODE_ENV: 'production',
      PORT: String(port),
      WEB_ORIGIN: url,
      LOG_LEVEL: 'warn',
      STANDALONE_DB_PATH: path.join(root, 'scli-team-workspace.sqlite'),
      STANDALONE_SESSION_SECRET: 'portable-team-workspace-local-session-2026',
      STANDALONE_ADMIN_NAME: 'SCLI Administrator',
      STANDALONE_ADMIN_EMAIL: 'admin@scientechnic.local',
      STANDALONE_ADMIN_PASSWORD: 'SCLI-Demo-2026!',
      LUMINAIRE_EXPORTER_PATH: exporterPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout?.on('data', (data) => console.log(String(data).trim()));
  apiProcess.stderr?.on('data', (data) => console.error(String(data).trim()));
  await waitForApi(url, apiProcess);
  return url;
}

async function startApi() {
  if (teamWorkspace) return startTeamApi();
  return startPersonalServer();
}

async function createWindow(url) {
  mainWindow = new BrowserWindow({
    title: appTitle,
    width: 1520,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#f7fafb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) void shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('close', (event) => {
    if (quitAllowed || closing) return;
    event.preventDefault();
    if (closeHandshake || !mainWindow) return;
    const windowAtRequest = mainWindow;
    const timer = setTimeout(() => {
      if (closeHandshake?.window !== windowAtRequest) return;
      closeHandshake = null;
      void gracefulQuit();
    }, CLOSE_HANDSHAKE_TIMEOUT_MS);
    closeHandshake = { window: windowAtRequest, timer };
    windowAtRequest.webContents.send('scli:close-requested');
  });
  await mainWindow.loadURL(url);
}

async function stopBackend() {
  if (personalServer) {
    await personalServer.stop();
    return;
  }
  if (apiProcess && apiProcess.exitCode === null) {
    try {
      apiProcess.kill();
    } catch {
      // Best-effort; the child may already be exiting.
    }
  }
}

function beginShutdown() {
  if (shutdownPromise) return shutdownPromise;
  closing = true;
  shutdownPromise = (async () => {
    try {
      await stopBackend();
    } finally {
      localAiRuntime?.stop();
      localAiRuntime = null;
      personalServer = null;
      apiProcess = null;
      shutdownPromise = null;
    }
  })();
  return shutdownPromise;
}

async function gracefulQuit() {
  await beginShutdown();
  quitAllowed = true;
  app.quit();
}

function showStartupFailure(error) {
  let message =
    'The local workspace service could not start. Check the application logs and try again.';
  if (
    error instanceof StartupBlockedError ||
    error instanceof RecoveryRequiredError ||
    error instanceof StartupFailedError ||
    error instanceof StartupTimeoutError
  ) {
    message = error.message;
  }
  const code = error instanceof PersonalServerProcessError ? error.code : 'UNKNOWN';
  console.error(`Personal server startup failed (${code}).`);
  dialog.showErrorBox(appTitle, message);
}

registerFolderPicker(ipcMain, openDialog, () => mainWindow);
ipcMain.handle('scli:select-file', async (_event, filters) => {
  const result = await openDialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: Array.isArray(filters) ? filters : [],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
registerLuminaireAssetPicker(ipcMain, openDialog, () => mainWindow);
ipcMain.handle('scli:open-path', async (_event, target) => {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return 'Invalid local path.';
  return shell.openPath(target);
});
ipcMain.handle('scli:reveal-in-folder', async (_event, target) => {
  // Narrow reveal: only an absolute path is accepted; the OS file manager
  // reveals/selects the item. No arbitrary command execution is exposed.
  if (typeof target !== 'string' || !path.isAbsolute(target)) return 'Invalid local path.';
  shell.showItemInFolder(target);
  return '';
});
ipcMain.handle('scli:read-local-image', async (_event, target) => readLocalImage(target));
ipcMain.handle('scli:open-external', async (_event, target) => {
  if (typeof target !== 'string' || !/^https:\/\//i.test(target)) return false;
  await shell.openExternal(target);
  return true;
});
ipcMain.handle('scli:open-contact-link', async (event, input) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame)
    return false;
  const target = contactLink(input);
  if (!target) return false;
  await shell.openExternal(target);
  return true;
});
ipcMain.handle('scli:integration-status', async () => listApplicationStatus(dataRoot()));
ipcMain.handle('scli:configure-integration', async (_event, application) => {
  if (application !== 'AUTOCAD' && application !== 'DIALUX') {
    throw new Error('Invalid integration configuration.');
  }
  const result = await openDialog.showOpenDialog(mainWindow, {
    title: `Select ${application === 'AUTOCAD' ? 'AutoCAD' : 'DIALux'} executable`,
    properties: ['openFile'],
    filters: [{ name: 'Windows application', extensions: ['exe'] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return configureApplication(application, result.filePaths[0], dataRoot());
});
ipcMain.handle('scli:prepare-automation-inbox', async (_event, toolContextId) =>
  prepareSessionInbox(dataRoot(), toolContextId),
);
ipcMain.handle('scli:launch-integrated-application', async (_event, input) =>
  launchApplication(input, dataRoot()),
);
ipcMain.handle('scli:execute-desktop-handoff', async (_event, input) =>
  executeDesktopHandoff(input, dataRoot(), {
    openPath: (target) => shell.openPath(target),
    reveal: (target) => shell.showItemInFolder(target),
    saveFile: async (fileName) => {
      const result = await openDialog.showSaveDialog(mainWindow, {
        title: 'Save a copy',
        defaultPath: fileName,
      });
      return result.canceled ? null : result.filePath;
    },
    pickFile: async (extensions) => {
      const result = await openDialog.showOpenDialog(mainWindow, {
        title:
          input?.expectedAction === 'SELECT_IMPORT_SOURCE'
            ? 'Select import source'
            : input?.expectedAction === 'SELECT_DOCUMENT_PDF'
              ? 'Select PDF for Document Review'
              : 'Capture File to Project',
        properties: ['openFile'],
        filters: [
          {
            name: 'Supported output',
            extensions: extensions.map((extension) => extension.replace(/^\./, '')),
          },
        ],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  }),
);
ipcMain.handle('scli:restart', async () => {
  await beginShutdown();
  quitAllowed = true;
  app.relaunch();
  app.quit();
  return true;
});
ipcMain.on('scli:close-response', (event, allow) => {
  if (!closeHandshake || event.sender !== closeHandshake.window.webContents) return;
  clearTimeout(closeHandshake.timer);
  closeHandshake = null;
  if (allow === true) void gracefulQuit();
});
ipcMain.handle('scli:export-pdf', async (_event, input) => {
  if (!input || typeof input.html !== 'string' || input.html.length > 2_000_000) return null;
  const suggestedName =
    typeof input.suggestedName === 'string' && /^[a-zA-Z0-9 _.-]+\.pdf$/i.test(input.suggestedName)
      ? input.suggestedName
      : 'SCT Project Report.pdf';
  const defaultDirectory =
    typeof input.defaultDirectory === 'string' && path.isAbsolute(input.defaultDirectory)
      ? input.defaultDirectory
      : app.getPath('documents');
  const result = await openDialog.showSaveDialog(mainWindow, {
    title: 'Save SCT Project Report',
    defaultPath: path.join(defaultDirectory, suggestedName),
    filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const reportWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    await reportWindow.loadURL(
      `data:text/html;base64,${Buffer.from(input.html, 'utf8').toString('base64')}`,
    );
    const pdf = await reportWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.35, bottom: 0.35, left: 0.35, right: 0.35 },
    });
    mkdirSync(path.dirname(result.filePath), { recursive: true });
    writeFileSync(result.filePath, pdf);
    return result.filePath;
  } finally {
    reportWindow.destroy();
  }
});

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('activate', () => {
    if (mainWindow && !closing) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      const origin = await startApi();
      // For the Personal workspace, the UI variant selects which renderer to
      // launch (V4 /v4 by default, or the explicit legacy renderer). Team modes
      // ignore the selector and always use the server origin root.
      const windowUrl = launchV4 ? windowUrlForUiVariant(origin, uiVariant) : origin;
      await createWindow(windowUrl);
    } catch (error) {
      if (!closing) showStartupFailure(error);
      await gracefulQuit();
    }
  });
}

app.on('before-quit', (event) => {
  if (quitAllowed) return;
  event.preventDefault();
  void gracefulQuit();
});
app.on('window-all-closed', () => {
  if (!closing) app.quit();
});
