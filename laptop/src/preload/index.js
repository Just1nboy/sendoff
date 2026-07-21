import { contextBridge, ipcRenderer } from 'electron';

const api = {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (partial) => ipcRenderer.invoke('settings:save', partial),
  login: () => ipcRenderer.invoke('auth:login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  listBatches: () => ipcRenderer.invoke('batch:list'),
  createBatch: () => ipcRenderer.invoke('batch:create'),
  selectBatch: (batch) => ipcRenderer.invoke('batch:select', batch),
  leaveBatch: () => ipcRenderer.invoke('batch:select', null),
  listStaging: () => ipcRenderer.invoke('staging:list'),
  getFileBytes: (fileId) => ipcRenderer.invoke('file:bytes', fileId),
  saveSprite: (sprite) => ipcRenderer.invoke('sprite:save', sprite),
  revealFile: (filePath) => ipcRenderer.invoke('shell:reveal', filePath),
  checkClientFolder: (name) => ipcRenderer.invoke('client:check', name),
  deliver: (payload) => ipcRenderer.invoke('deliver', payload),
  getHistory: () => ipcRenderer.invoke('history:list'),
  copyText: (text) => ipcRenderer.invoke('clipboard:copy', text),
  openLink: (url) => ipcRenderer.invoke('shell:open', url),
  // the gif Neku spotted landing in Downloads, if he has not used it yet
  getLatestGif: () => ipcRenderer.invoke('gif:latest'),
  readGif: (filePath) => ipcRenderer.invoke('gif:read', filePath),
  setGifAttached: (attached) => ipcRenderer.invoke('gif:attached', attached),
  getGifWatchInfo: () => ipcRenderer.invoke('gif:watching'),
  discardStaged: (fileId) => ipcRenderer.invoke('staging:discard', fileId),
  announceSprite: (sprite) => ipcRenderer.invoke('sprite:arrived', sprite),
  onDeliverStep: (cb) => {
    const handler = (_event, step) => cb(step);
    ipcRenderer.on('deliver:step', handler);
    return () => ipcRenderer.removeListener('deliver:step', handler);
  },
  onGifFound: (cb) => {
    const handler = (_event, gif) => cb(gif);
    ipcRenderer.on('gif:found', handler);
    return () => ipcRenderer.removeListener('gif:found', handler);
  },
  // fires when he clicks "Use it" on the corner notice
  onGifUse: (cb) => {
    const handler = (_event, gif) => cb(gif);
    ipcRenderer.on('gif:use', handler);
    return () => ipcRenderer.removeListener('gif:use', handler);
  },
};

contextBridge.exposeInMainWorld('neku', api);

/* The corner notice window shares this preload; it only ever needs these three. */
contextBridge.exposeInMainWorld('nekuNotice', {
  use: () => ipcRenderer.invoke('notice:use'),
  dismiss: () => ipcRenderer.invoke('notice:dismiss'),
  preview: () => ipcRenderer.invoke('notice:preview'),
});
