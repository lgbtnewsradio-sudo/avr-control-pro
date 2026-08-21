const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('integra', {
  cmd: (message) => ipcRenderer.send('cmd', message),
  getState: () => ipcRenderer.invoke('get-state'),
  discover: () => ipcRenderer.invoke('discover'),
  connect: (opts) => ipcRenderer.invoke('connect', opts),
  reconnect: () => ipcRenderer.invoke('reconnect'),
  openSetup: () => ipcRenderer.invoke('open-setup'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onDiscovered: (cb) => ipcRenderer.on('discovered', (_e, d) => cb(d)),
  win: (action) => ipcRenderer.send('win', action),
  setView: (view) => ipcRenderer.send('set-view', view),
  miniResize: (h) => ipcRenderer.send('mini-resize', h),
  miniPin: (pinned) => ipcRenderer.send('mini-pin', pinned),
});
