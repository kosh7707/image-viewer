import { BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import { loadAlbum, type AlbumLoadEntry } from './album-loader';
import { SUPPORTED_EXTS } from './folder';
import { walkImages } from './walk';
import type { AlbumEntryDTO, AlbumProgressPhase } from '../preload/api';

type SetAlbumPaths = (images: string[]) => void;

let setAlbumPathsImpl: SetAlbumPaths = () => undefined;

/** Wired by main.ts at module load to share the security allowlist. */
export function bindSetAlbumPaths(fn: SetAlbumPaths): void {
  setAlbumPathsImpl = fn;
}

export function entriesToDTO(entries: AlbumLoadEntry[]): AlbumEntryDTO[] {
  return entries.map((e) => ({
    path: e.path,
    mtimeMs: e.mtimeMs,
  }));
}

function sendAlbumProgress(
  win: BrowserWindow,
  phase: AlbumProgressPhase,
  completed: number,
  total: number,
  bytesSoFar: number,
): void {
  if (!win.isDestroyed()) {
    win.webContents.send('album:progress', { phase, completed, total, bytesSoFar });
  }
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * IDENTIFY -> broadcast album:load.
 * File decode and RAM-budgeted preload run later in the renderer.
 */
export async function executeAlbumLoad(
  rootDir: string,
  win: BrowserWindow,
  selectedFile: string | null,
): Promise<void> {
  const resolvedRoot = path.resolve(rootDir);
  sendAlbumProgress(win, 'scanning', 0, 0, 0);
  await yieldToUi();

  const result = await loadAlbum(resolvedRoot, {
    walk: (root) => walkImages(root),
  });

  if (result.status !== 'ok') {
    sendAlbumProgress(win, 'preloading', 0, 0, 0);
    return;
  }

  setAlbumPathsImpl(result.entries.map((e) => e.path));
  let idx = 0;
  if (selectedFile) {
    const sel = path.resolve(selectedFile);
    const found = result.entries.findIndex((e) => path.resolve(e.path) === sel);
    if (found >= 0) idx = found;
  }
  if (!win.isDestroyed()) {
    win.webContents.send('album:load', {
      folder: resolvedRoot,
      entries: entriesToDTO(result.entries),
      currentIndex: idx,
    });
  }
}

/** Show the open-file dialog and drive album load on selection. */
export async function openFileDialogAndLoad(win: BrowserWindow): Promise<void> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      {
        name: 'Images',
        extensions: SUPPORTED_EXTS.map((e) => e.replace(/^\./, '')),
      },
    ],
  });
  if (result.canceled || !result.filePaths[0]) return;
  const file = result.filePaths[0];
  await executeAlbumLoad(path.dirname(file), win, file);
}

/** Show the open-folder dialog and drive album load on selection. */
export async function openFolderDialogAndLoad(win: BrowserWindow): Promise<void> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return;
  await executeAlbumLoad(result.filePaths[0], win, null);
}
