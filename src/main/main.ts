import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { SUPPORTED_EXTS } from './folder';
import {
  executeAlbumLoad,
  bindSetAlbumPaths,
  openFileDialogAndLoad,
  openFolderDialogAndLoad,
} from './album-flow';
import { toggleFullscreen } from './window';
import { showContextMenu, menuState } from './menu';
import { startRssMonitor, stopRssMonitor } from './rss';

let mainWindow: BrowserWindow | null = null;

// Defense-in-depth: the renderer may only read files belonging to the most
// recently broadcast album. Each entry is an absolute, resolved path string.
const currentAlbumPaths: Set<string> = new Set();

export function setAlbumPaths(images: string[]): void {
  currentAlbumPaths.clear();
  for (const p of images) {
    try {
      currentAlbumPaths.add(path.resolve(p));
    } catch {
      // skip un-resolvable entries
    }
  }
}

bindSetAlbumPaths(setAlbumPaths);

function pickArgPath(): string | null {
  const candidates = [process.argv[1], process.argv[2]].filter(Boolean) as string[];
  for (const c of candidates) {
    if (c === '.' || c === '--') continue;
    try {
      fs.statSync(c);
      return c;
    } catch {
      // not a real path, skip
    }
  }
  return null;
}

async function handleArgPath(argPath: string, win: BrowserWindow): Promise<void> {
  try {
    const abs = path.resolve(argPath);
    const st = fs.statSync(abs);
    if (st.isFile()) {
      const folder = path.dirname(abs);
      await executeAlbumLoad(folder, win, abs);
    } else if (st.isDirectory()) {
      await executeAlbumLoad(abs, win, null);
    }
  } catch {
    // bad arg; ignore
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    frame: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) return;
    const arg = pickArgPath();
    if (arg) {
      void handleArgPath(arg, mainWindow);
    }
    startRssMonitor(mainWindow);
  });

  mainWindow.on('closed', () => {
    stopRssMonitor();
    mainWindow = null;
  });
}

// --- IPC wiring ---
ipcMain.handle('window:toggleFullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  return toggleFullscreen(win);
});

ipcMain.handle('menu:show', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  showContextMenu(win);
});

ipcMain.handle('speed:update', (_event, mult: number) => {
  if (typeof mult === 'number' && Number.isFinite(mult)) {
    menuState.speedMultiplier = mult;
  }
});

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  if (typeof filePath !== 'string') {
    throw new Error('filePath must be a string');
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!(SUPPORTED_EXTS as readonly string[]).includes(ext)) {
    throw new Error(`Unsupported extension: ${ext}`);
  }
  const resolved = path.resolve(filePath);
  if (!currentAlbumPaths.has(resolved)) {
    throw new Error('path not in active album');
  }
  return await fs.promises.readFile(resolved);
});

ipcMain.handle('dialog:openFile', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  await openFileDialogAndLoad(win);
});

ipcMain.handle('dialog:openFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  await openFolderDialogAndLoad(win);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
