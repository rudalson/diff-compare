import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  selectDirectory: (defaultPath?: string) => ipcRenderer.invoke('select-directory', defaultPath),
  selectFile: (defaultPath?: string) => ipcRenderer.invoke('select-file', defaultPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),
  copyFile: (srcPath: string, destPath: string) => ipcRenderer.invoke('copy-file', srcPath, destPath),
  deleteItem: (itemPath: string) => ipcRenderer.invoke('delete-item', itemPath),
  scanDirectory: (dirPath: string) => ipcRenderer.invoke('scan-directory', dirPath),
  compareFiles: (leftPath: string, rightPath: string) => ipcRenderer.invoke('compare-files', leftPath, rightPath),
});
