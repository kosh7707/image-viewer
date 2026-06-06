import { BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import { loadAlbum, type AlbumLoadEntry } from './album-loader';
import { SUPPORTED_EXTS } from './folder';
import { walkImages } from './walk';
import type { AlbumEntryDTO, AlbumProgressPhase } from '../preload/api';

type SetAlbumPaths = (images: string[]) => void;

let setAlbumPathsImpl: SetAlbumPaths = () => undefined;
const NATURAL_PATH_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export interface AlbumLoadRequest {
  rootDir: string;
  selectedFile: string | null;
}

/** Wired by main.ts at module load to share the security allowlist. */
export function bindSetAlbumPaths(fn: SetAlbumPaths): void {
  setAlbumPathsImpl = fn;
}

export function entriesToDTO(entries: AlbumLoadEntry[]): AlbumEntryDTO[] {
  return entries.map((e) => {
    const dto: AlbumEntryDTO = {
      path: e.path,
      mtimeMs: e.mtimeMs,
    };
    if (typeof e.encodedBytes === 'number' && Number.isFinite(e.encodedBytes)) {
      dto.encodedBytes = e.encodedBytes;
    }
    return dto;
  });
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
  await executeAlbumLoadRequests([{ rootDir, selectedFile }], win);
}

export async function executeAlbumLoadRequests(
  requests: AlbumLoadRequest[],
  win: BrowserWindow,
): Promise<void> {
  const normalized = normalizeAlbumLoadRequests(requests);
  const selectedFile = normalized.map((request) => request.selectedFile).find(Boolean);
  const ordered = normalized.slice().sort(compareAlbumLoadRequestRoot);
  sendAlbumProgress(win, 'scanning', 0, 0, 0);
  await yieldToUi();

  const entries: AlbumLoadEntry[] = [];
  const seenPaths = new Set<string>();
  for (const request of ordered) {
    const result = await loadAlbum(request.rootDir, {
      walk: (root) => walkImages(root),
    });
    if (result.status !== 'ok') continue;

    for (const entry of result.entries) {
      const key = path.resolve(entry.path).toLowerCase();
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      entries.push(entry);
    }
  }

  if (entries.length === 0) {
    sendAlbumProgress(win, 'preloading', 0, 0, 0);
    return;
  }

  setAlbumPathsImpl(entries.map((e) => e.path));
  let idx = 0;
  if (selectedFile) {
    const sel = path.resolve(selectedFile);
    const found = entries.findIndex((e) => path.resolve(e.path) === sel);
    if (found >= 0) idx = found;
  }
  if (!win.isDestroyed()) {
    win.webContents.send('album:load', {
      folder: albumFolderLabel(ordered),
      entries: entriesToDTO(entries),
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
    properties: ['openDirectory', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths[0]) return;
  await executeAlbumLoadRequests(
    result.filePaths.map((rootDir) => ({ rootDir, selectedFile: null })),
    win,
  );
}

function normalizeAlbumLoadRequests(requests: AlbumLoadRequest[]): AlbumLoadRequest[] {
  const normalized: AlbumLoadRequest[] = [];
  const seenRoots = new Set<string>();
  for (const request of requests) {
    const rootDir = path.resolve(request.rootDir);
    const key = rootDir.toLowerCase();
    if (seenRoots.has(key)) continue;
    seenRoots.add(key);
    normalized.push({
      rootDir,
      selectedFile: request.selectedFile ? path.resolve(request.selectedFile) : null,
    });
  }
  return normalized;
}

function albumFolderLabel(requests: AlbumLoadRequest[]): string {
  if (requests.length <= 1) return requests[0]?.rootDir ?? '';
  return `${requests[0]!.rootDir} + ${requests.length - 1}`;
}

function compareAlbumLoadRequestRoot(left: AlbumLoadRequest, right: AlbumLoadRequest): number {
  const leftParts = left.rootDir.split(/[\\/]+/).filter(Boolean);
  const rightParts = right.rootDir.split(/[\\/]+/).filter(Boolean);
  const length = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const natural = NATURAL_PATH_COLLATOR.compare(leftParts[index]!, rightParts[index]!);
    if (natural !== 0) return natural;
  }
  return leftParts.length - rightParts.length;
}
