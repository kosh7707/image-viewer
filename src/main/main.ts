import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { SUPPORTED_EXTS } from './folder';
import { toggleFullscreen } from './window';
import type { UserPreferences } from '../shared/user-preferences';
import { applyPortableRuntimePaths, type PortableLayout } from './portable-runtime';
import { createBootTimingLogger, type BootTimingLogger } from './boot-timing';

let mainWindow: BrowserWindow | null = null;
let albumFlowPromise: Promise<typeof import('./album-flow')> | null = null;
let preferencesModulePromise: Promise<typeof import('./preferences')> | null = null;
let rssModulePromise: Promise<typeof import('./rss')> | null = null;
let menuModulePromise: Promise<typeof import('./menu')> | null = null;
let animationSpeedMultiplier = 1.0;

const processStartedAt = Date.now();
const portableLayout = applyPortableRuntimePaths({
  env: process.env,
  execPath: process.execPath,
  setPath: (name, value) => app.setPath(name, value),
  setAppLogsPath: (value) => app.setAppLogsPath(value),
});
const bootLogger = createOptionalBootLogger(portableLayout);

Menu.setApplicationMenu(null);
logBootEvent('main-start');

function userDataDir(): string {
  return app.getPath('userData');
}

function loadPreferencesModule(): Promise<typeof import('./preferences')> {
  preferencesModulePromise ??= import('./preferences');
  return preferencesModulePromise;
}

function loadRssModule(): Promise<typeof import('./rss')> {
  rssModulePromise ??= import('./rss');
  return rssModulePromise;
}

function loadMenuModule(): Promise<typeof import('./menu')> {
  menuModulePromise ??= import('./menu');
  return menuModulePromise;
}

async function loadPreferences(): Promise<UserPreferences> {
  const preferences = await loadPreferencesModule();
  return await preferences.loadPreferences(userDataDir());
}

async function startRssMonitorForWindow(win: BrowserWindow): Promise<void> {
  try {
    const rss = await loadRssModule();
    if (!win.isDestroyed()) {
      rss.startRssMonitor(win);
    } else {
      rss.stopRssMonitor();
    }
  } catch {
    // RSS monitoring is diagnostic only and must not affect startup.
  }
}

function stopRssMonitorIfLoaded(): void {
  if (!rssModulePromise) return;
  void rssModulePromise
    .then((rss) => {
      rss.stopRssMonitor();
    })
    .catch(() => {
      // Ignore failed optional RSS monitor imports.
    });
}

async function showContextMenuForWindow(
  win: BrowserWindow,
  point?: { x: number; y: number },
): Promise<void> {
  try {
    const menu = await loadMenuModule();
    if (win.isDestroyed()) return;
    menu.showContextMenu(win, point, {
      speedMultiplier: animationSpeedMultiplier,
      openFile: async () => {
        const { openFileDialogAndLoad } = await loadAlbumFlow();
        await openFileDialogAndLoad(win);
      },
      openFolder: async () => {
        const { openFolderDialogAndLoad } = await loadAlbumFlow();
        await openFolderDialogAndLoad(win);
      },
    });
  } catch {
    // Context menus are optional and must not make menu:show reject.
  }
}

function createOptionalBootLogger(layout: PortableLayout | null): BootTimingLogger | null {
  const logsDir = process.env.IMAGEVIEWER_BOOT_LOG_DIR?.trim() || layout?.logsDir;
  return logsDir ? createBootTimingLogger(logsDir) : null;
}

function logBootEvent(event: string): void {
  try {
    bootLogger?.log(event, { elapsedMs: Date.now() - processStartedAt });
  } catch {
    // Boot timing must never prevent the viewer from opening.
  }
}

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

async function loadAlbumFlow(): Promise<typeof import('./album-flow')> {
  albumFlowPromise ??= import('./album-flow').then((mod) => {
    mod.bindSetAlbumPaths(setAlbumPaths);
    return mod;
  });
  return await albumFlowPromise;
}

function resolveReadableAlbumImage(filePath: string): string {
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
  return resolved;
}

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
    const { executeAlbumLoad } = await loadAlbumFlow();
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
  logBootEvent('window-created');
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('dom-ready', () => {
    logBootEvent('renderer-dom-ready');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    logBootEvent('renderer-loaded');
    if (!mainWindow) return;
    const arg = pickArgPath();
    if (arg) {
      void handleArgPath(arg, mainWindow);
    }
    void startRssMonitorForWindow(mainWindow);
  });

  mainWindow.on('closed', () => {
    stopRssMonitorIfLoaded();
    mainWindow = null;
  });
}

// --- IPC wiring ---
ipcMain.handle('window:toggleFullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  return toggleFullscreen(win);
});

ipcMain.handle('menu:show', async (event, point?: { x: number; y: number }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  await showContextMenuForWindow(win, point);
});

ipcMain.handle('speed:update', async (_event, mult: number) => {
  if (typeof mult === 'number' && Number.isFinite(mult)) {
    const preferences = await loadPreferencesModule();
    const saved = await preferences.updateAnimationSpeed(userDataDir(), mult);
    animationSpeedMultiplier = saved.animation.speedMultiplier;
  }
});

ipcMain.handle('preferences:get', async (): Promise<UserPreferences> => {
  return await loadPreferences();
});

ipcMain.handle('preload-limit:update', async (_event, bytes: number): Promise<UserPreferences> => {
  const preferences = await loadPreferencesModule();
  return await preferences.updateAnimatedPreloadMemoryLimit(userDataDir(), bytes);
});

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const resolved = resolveReadableAlbumImage(filePath);
  return await fs.promises.readFile(resolved);
});

ipcMain.handle('fs:fileUrl', (_event, filePath: string) => {
  const resolved = resolveReadableAlbumImage(filePath);
  return pathToFileURL(resolved).toString();
});

ipcMain.handle('dialog:openFile', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const { openFileDialogAndLoad } = await loadAlbumFlow();
  await openFileDialogAndLoad(win);
});

ipcMain.handle('dialog:openFolder', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const { openFolderDialogAndLoad } = await loadAlbumFlow();
  await openFolderDialogAndLoad(win);
});

ipcMain.handle('app:quit', () => {
  app.quit();
});

ipcMain.on('boot:renderer-ready', () => {
  logBootEvent('renderer-ready');
});

app.whenReady().then(() => {
  logBootEvent('app-ready');
  createWindow();
  void loadPreferences()
    .then((prefs) => {
      animationSpeedMultiplier = prefs.animation.speedMultiplier;
      logBootEvent('preferences-loaded');
    })
    .catch(() => {
      logBootEvent('preferences-load-failed');
    });
});

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
