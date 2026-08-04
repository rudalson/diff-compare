import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { runFileCompare } from './diffEngine';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'TinyDiff',
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
ipcMain.handle('select-directory', async (_, defaultPath?: string) => {
  if (!mainWindow) return null;
  const options: Electron.OpenDialogOptions = {
    properties: ['openDirectory'],
  };
  if (defaultPath && fs.existsSync(defaultPath)) {
    options.defaultPath = defaultPath;
  }
  const result = await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// Select File Dialog
ipcMain.handle('select-file', async (_, defaultPath?: string) => {
  if (!mainWindow) return null;
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
  };
  if (defaultPath && fs.existsSync(defaultPath)) {
    options.defaultPath = defaultPath;
  }
  const result = await dialog.showOpenDialog(mainWindow, options);
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

// Copy File (Fast OS native copy for large binary files + timestamp preservation)
ipcMain.handle('copy-file', async (_, srcPath: string, destPath: string) => {
  try {
    const destDir = path.dirname(destPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    await fs.promises.copyFile(srcPath, destPath);
    // Preserve source file's access and modification timestamps
    const stat = fs.statSync(srcPath);
    fs.utimesSync(destPath, stat.atime, stat.mtime);
    return true;
  } catch (error: any) {
    throw new Error(`Failed to copy file: ${error.message}`);
  }
});

// Delete File or Directory
ipcMain.handle('delete-item', async (_, itemPath: string) => {
  try {
    if (!fs.existsSync(itemPath)) return true;
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      fs.rmSync(itemPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(itemPath);
    }
    return true;
  } catch (error: any) {
    throw new Error(`Failed to delete item: ${error.message}`);
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
  isHidden: boolean;
}

const KNOWN_HIDDEN_NAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  'iconcache.db',
  '$recycle.bin',
  'system volume information',
  'ntuser.dat',
  'ntuser.dat.log1',
  'ntuser.dat.log2',
  'ntuser.ini',
]);

function getWinHiddenNames(dirPath: string): Set<string> {
  if (process.platform !== 'win32') return new Set();
  try {
    const stdout = execSync(`cmd.exe /c "dir /a:h /b "${dirPath}" 2>nul"`, {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const lines = stdout.split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean);
    return new Set(lines);
  } catch {
    return new Set();
  }
}

// Scan Directory recursively
ipcMain.handle('scan-directory', async (_, dirPath: string) => {
  try {
    const results: FileNode[] = [];

    const walk = (currentDir: string, parentIsHidden = false) => {
      try {
        const winHiddenSet = getWinHiddenNames(currentDir);
        const files = fs.readdirSync(currentDir);
        for (const file of files) {
          try {
            const fullPath = path.join(currentDir, file);
            const relativePath = path.relative(dirPath, fullPath).replace(/\\/g, '/');
            const stat = fs.statSync(fullPath);
            
            const isDotFile = file.startsWith('.');
            const isKnownHidden = KNOWN_HIDDEN_NAMES.has(file.toLowerCase());
            const isWinHidden = winHiddenSet.has(file.toLowerCase());
            const isHidden = parentIsHidden || isDotFile || isKnownHidden || isWinHidden;

            if (stat.isDirectory()) {
              results.push({
                name: file,
                path: fullPath,
                relativePath,
                isDirectory: true,
                size: 0,
                mtimeMs: stat.mtimeMs,
                isHidden,
              });
              walk(fullPath, isHidden);
            } else {
              results.push({
                name: file,
                path: fullPath,
                relativePath,
                isDirectory: false,
                size: stat.size,
                mtimeMs: stat.mtimeMs,
                isHidden,
              });
            }
          } catch (e) {
            // Ignore single file/folder stat or access errors
          }
        }
      } catch (e) {
        // Ignore directory read errors (e.g. permission denied)
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
