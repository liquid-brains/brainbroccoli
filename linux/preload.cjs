const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brainBroccoliDevice', {
  request: (url) => ipcRenderer.invoke('device-request', String(url)),
});
