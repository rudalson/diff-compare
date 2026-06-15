import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { runFileCompare } from './diffEngine';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Antigravity Diff Compare',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset', // beautiful native titlebar style on macOS
  });

  // Load the web app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC IPC HANDLERS ---

// Select Directory Dialog
ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Select File Dialog
ipcMain.handle('select-file', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Read File Content
ipcMain.handle('read-file', async (_, filePath: string) => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error: any) {
    throw new Error(`Failed to read file: ${error.message}`);
  }
});

// Write File Content
ipcMain.handle('write-file', async (_, filePath: string, content: string) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch (error: any) {
    throw new Error(`Failed to write file: ${error.message}`);
  }
});

// Helper interface for directory scanning
interface FileNode {
  name: string;
  path: string; // Absolute path
  relativePath: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
}

// Scan Directory recursively
ipcMain.handle('scan-directory', async (_, dirPath: string) => {
  try {
    const results: FileNode[] = [];

    const walk = (currentDir: string) => {
      const files = fs.readdirSync(currentDir);
      for (const file of files) {
        const fullPath = path.join(currentDir, file);
        const relativePath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          results.push({
            name: file,
            path: fullPath,
            relativePath,
            isDirectory: true,
            size: 0,
            mtimeMs: stat.mtimeMs,
          });
          walk(fullPath);
        } else {
          results.push({
            name: file,
            path: fullPath,
            relativePath,
            isDirectory: false,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          });
        }
      }
    };

    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      walk(dirPath);
    }
    return results;
  } catch (error: any) {
    throw new Error(`Failed to scan directory: ${error.message}`);
  }
});

// Compare two text files
ipcMain.handle('compare-files', async (_, leftPath: string, rightPath: string) => {
  try {
    const leftText = fs.existsSync(leftPath) ? fs.readFileSync(leftPath, 'utf-8') : null;
    const rightText = fs.existsSync(rightPath) ? fs.readFileSync(rightPath, 'utf-8') : null;
    return runFileCompare(leftText, rightText);
  } catch (error: any) {
    throw new Error(`Failed to compare files: ${error.message}`);
  }
});
