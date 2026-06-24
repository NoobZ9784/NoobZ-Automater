const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  close: () => ipcRenderer.send('window:close'),
  togglePin: () => ipcRenderer.invoke('window:toggle-pin'),
  play: (opts) => ipcRenderer.invoke('automation:play', opts),
  cancel: () => ipcRenderer.send('automation:cancel'),
  onCountdown: (cb) => ipcRenderer.on('automation:countdown', (_e, val) => cb(val))
});
