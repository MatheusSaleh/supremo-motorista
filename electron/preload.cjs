// Ponte segura entre o jogo (página) e o processo principal do Electron.
// Exposta como window.desktop; no navegador ela não existe e o jogo esconde as opções de desktop.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getConfig: () => ipcRenderer.invoke('desktop:get-config'),
  setConfig: (patch) => ipcRenderer.invoke('desktop:set-config', patch),
  gpuInfo: () => ipcRenderer.invoke('desktop:gpu-info'),
  relaunch: () => ipcRenderer.send('desktop:relaunch'),
  quit: () => ipcRenderer.send('desktop:quit'),
});
