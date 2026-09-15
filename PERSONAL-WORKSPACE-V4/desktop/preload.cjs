const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scliDesktop', {
  selectFolder: () => ipcRenderer.invoke('scli:select-folder'),
  selectFile: (filters) => ipcRenderer.invoke('scli:select-file', filters),
  selectLuminaireAssetFile: (assetType) =>
    ipcRenderer.invoke('scli:select-luminaire-asset-file', assetType),
  selectStudioAsset: (assetType) => ipcRenderer.invoke('scli:select-studio-asset', assetType),
  openPath: (target) => ipcRenderer.invoke('scli:open-path', target),
  revealInFolder: (target) => ipcRenderer.invoke('scli:reveal-in-folder', target),
  readLocalImage: (target) => ipcRenderer.invoke('scli:read-local-image', target),
  openExternal: (target) => ipcRenderer.invoke('scli:open-external', target),
  openContactLink: (input) => ipcRenderer.invoke('scli:open-contact-link', input),
  exportPdf: (input) => ipcRenderer.invoke('scli:export-pdf', input),
  integrationStatus: () => ipcRenderer.invoke('scli:integration-status'),
  configureIntegration: (application) =>
    ipcRenderer.invoke('scli:configure-integration', application),
  executeDesktopHandoff: (handoffId, expectedAction) =>
    ipcRenderer.invoke('scli:execute-desktop-handoff', { handoffId, expectedAction }),
  restart: () => ipcRenderer.invoke('scli:restart'),
  onCloseRequested: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const wrapped = () => listener();
    ipcRenderer.on('scli:close-requested', wrapped);
    return () => ipcRenderer.removeListener('scli:close-requested', wrapped);
  },
  respondToClose: (allow) => ipcRenderer.send('scli:close-response', allow === true),
  isDesktop: true,
});
