import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  scanDirectory: (dirPath: string) => ipcRenderer.invoke('scan-directory', dirPath),
  compareFiles: (leftPath: string, rightPath: string) => ipcRenderer.invoke('compare-files', leftPath, rightPath),
});
