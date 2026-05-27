import { BrowserWindow, dialog } from 'electron';
import * as path from 'path';
import { walkImages } from './walk';
import { estimateFromFile } from './measure';
import { loadAlbum, DEFAULT_SOFT_CAP_BYTES, type MeasuredWalkEntry } from './album-loader';
import { SUPPORTED_EXTS } from './folder';
import type { AlbumEntryDTO, AlbumProgressPhase } from '../preload/api';

type SetAlbumPaths = (images: string[]) => void;

let setAlbumPathsImpl: SetAlbumPaths = () => undefined;

/** Wired by main.ts at module load to share the security allowlist. */
export function bindSetAlbumPaths(fn: SetAlbumPaths): void {
  setAlbumPathsImpl = fn;
}

export function entriesToDTO(entries: MeasuredWalkEntry[]): AlbumEntryDTO[] {
  return entries.map((e) => ({
    path: e.path,
    mtimeMs: e.mtimeMs,
    width: e.estimate.width,
    height: e.estimate.height,
    frameCount: e.estimate.frameCount,
    estimatedBytes: e.estimate.preloadBytes,
    encodedBytes: e.estimate.encodedBytes,
    allFramesDecodedBytes: e.estimate.bytes,
    playbackBytes: e.estimate.playbackBytes,
  }));
}

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(0);
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
 * IDENTIFY -> MEASURE -> (CONFIRM if over cap) -> broadcast album:load.
 * Progress events are pushed to the renderer during measure.
 * If user cancels at the confirm dialog, the prior album is kept (no-op).
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
    measureFile: (p) => estimateFromFile(p),
    confirmOverCap: async (totalBytes, count) => {
      const r = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['취소', '진행'],
        defaultId: 0,
        cancelId: 0,
        title: '큰 폴더',
        message: '폴더가 매우 큽니다',
        detail: `이 폴더의 이미지 ${count}장 중 정적 이미지 preload/cache에 약 ${formatMB(
          totalBytes,
        )} MB가 필요합니다 (소프트 캡 ${formatMB(DEFAULT_SOFT_CAP_BYTES)} MB 초과). GIF/animated WebP는 별도 재생 정책으로 처리합니다. 진행하시겠습니까?`,
      });
      return r.response === 1;
    },
    onProgress: (phase, completed, total, bytesSoFar) => {
      sendAlbumProgress(win, phase, completed, total, bytesSoFar);
    },
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
