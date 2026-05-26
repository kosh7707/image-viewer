import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { listImages, resolveArg, SUPPORTED_EXTS } from './folder';
import { toggleFullscreen } from './window';
import { showContextMenu, menuState } from './menu';
import { startRssMonitor, stopRssMonitor } from './rss';

let mainWindow: BrowserWindow | null = null;

// Defense-in-depth: the renderer may only read files belonging to the
// most recently broadcast album. Populated whenever an album is loaded.
// Each entry is an absolute, resolved path string.
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

function pickArgPath(): string | null {
  // In packaged mode argv[0] is the exe, argv[1] is the file.
  // In dev (electron .) argv[0] is electron, argv[1] is '.', argv[2] is the file.
  // We try argv[1] first; if it's '.' or non-existent, try argv[2].
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
      const resolved = resolveArg(arg);
      if (resolved) {
        setAlbumPaths(resolved.images);
        mainWindow.webContents.send('album:load', {
          folder: resolved.folder,
          images: resolved.images,
          currentIndex: resolved.currentIndex,
        });
      }
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
  // Validate extension to prevent arbitrary reads.
  const ext = path.extname(filePath).toLowerCase();
  if (!(SUPPORTED_EXTS as readonly string[]).includes(ext)) {
    throw new Error(`Unsupported extension: ${ext}`);
  }
  // Defense-in-depth: only allow reads of paths in the active album.
  // Prevents a compromised renderer from reading arbitrary files.
  const resolved = path.resolve(filePath);
  if (!currentAlbumPaths.has(resolved)) {
    throw new Error('path not in active album');
  }
  const buffer = await fs.promises.readFile(resolved);
  // Return the underlying ArrayBuffer to renderer (will arrive as Uint8Array).
  return buffer;
});

ipcMain.handle('dialog:openFile', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      {
        name: 'Images',
        extensions: SUPPORTED_EXTS.map((e) => e.replace(/^\./, '')),
      },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const file = result.filePaths[0];
  const folder = path.dirname(file);
  const images = listImages(folder);
  const idx = images.findIndex((p) => p === file);
  setAlbumPaths(images);
  return { folder, images, currentIndex: idx >= 0 ? idx : 0 };
});

ipcMain.handle('dialog:openFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const folder = result.filePaths[0];
  const images = listImages(folder);
  setAlbumPaths(images);
  return { folder, images, currentIndex: 0 };
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
