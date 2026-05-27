/**
 * renderer.ts — bootstraps the renderer process.
 *
 * Wires together:
 *   - Album state (entries: path + mtimeMs)
 *   - CanvasPainter
 *   - CacheGovernor (high caps; album-loader gates RAM via 4 GB confirm)
 *   - PreloadQueue (scheduleAll — every static image in the album)
 *   - Input dispatch
 *   - GifHost
 *   - Context menu host
 *   - RSS toast
 *   - Progress toast (measure + preload)
 *   - Sort dialog (modal)
 */

import { Album } from './album';
import { CanvasPainter } from './canvas';
import { CacheGovernor } from './cache-governor';
import { PreloadQueue } from './preload-queue';
import { installKeyboard } from './input';
import { GifHost } from './gif-host';
import { installContextMenu, pushSpeed } from './menu-host';
import { RssToast } from './toast';
import { ProgressToast } from './progress-toast';
import { SortDialog } from './sort-dialog';
import { mediaKindForEntry } from './media-kind';
import { NativeImageHost } from './native-image-host';
import { decodeAnimatedWebp } from './animated-webp-decoder';
import { disposeFrames } from './animation-disposal';
import { SpeedHud } from './speed-hud';
import {
  MAX_NATIVE_GIF_BYTES,
  shouldUseNativeAnimatedWebp,
  shouldUseNativeGif,
} from './animation-policy';
import type { AlbumEntryDTO } from '../preload/api';

const canvasEl = document.getElementById('canvas') as HTMLCanvasElement;
const fallbackImg = document.getElementById('fallback-gif') as HTMLImageElement;
const toastHost = document.getElementById('toast-host') as HTMLElement;
const dialogHost = document.getElementById('dialog-host') as HTMLElement;

const painter = new CanvasPainter(canvasEl);
const album = new Album();
// High caps: album-loader's 4 GB confirm is the real RAM gate; cache only
// evicts via evictAll() on a new album.
const governor = new CacheGovernor({
  maxEntries: Number.MAX_SAFE_INTEGER,
  maxBytes: Number.MAX_SAFE_INTEGER,
});
const preloader = new PreloadQueue(governor);
const gifHost = new GifHost(painter, (s) => pushSpeed(s));
const nativeImageHost = new NativeImageHost(fallbackImg);

const rssToast = new RssToast(toastHost);
rssToast.install();
const progressToast = new ProgressToast(toastHost);
const speedHud = new SpeedHud(toastHost);
const sortDialog = new SortDialog(dialogHost, {
  onSortChange: (entries, newIdx) => {
    album.reorder(entries, newIdx);
    bumpEpoch();
    void renderCurrent();
  },
  onJumpTo: (idx) => {
    if (idx < 0 || idx >= album.size()) return;
    album.state.currentIndex = idx;
    bumpEpoch();
    void renderCurrent();
  },
});

installContextMenu(() => gifHost.speedMultiplier);

let navEpoch = 0;
let albumEpoch = 0;
function bumpEpoch(): number {
  navEpoch += 1;
  return navEpoch;
}
preloader.setEpochSupplier(() => albumEpoch);

let activeGifWorker: Worker | null = null;

function clearGif(): void {
  gifHost.stop();
  if (activeGifWorker) {
    activeGifWorker.terminate();
    activeGifWorker = null;
  }
  nativeImageHost.clear();
  painter.clear();
}

async function renderCurrent(): Promise<void> {
  const myEpoch = navEpoch;
  const current = album.currentEntry();
  if (!current) {
    clearGif();
    painter.clear();
    return;
  }
  clearGif();
  switch (mediaKindForEntry(current)) {
    case 'animated-gif':
      await renderGif(current, myEpoch);
      break;
    case 'webp':
      await renderWebp(current, myEpoch);
      break;
    case 'static-bitmap':
      await renderStatic(current.path, myEpoch);
      break;
  }
}

async function showNativePath(filePath: string, myEpoch: number): Promise<void> {
  const url = await window.api.fileUrl(filePath);
  if (myEpoch !== navEpoch) return;
  nativeImageHost.showUrl(url);
}

async function renderWebp(current: AlbumEntryDTO, myEpoch: number): Promise<void> {
  const filePath = current.path;
  try {
    if (shouldUseNativeAnimatedWebp(current)) {
      await showNativePath(filePath, myEpoch);
      return;
    }

    const bytes = await window.api.readFile(filePath);
    if (myEpoch !== navEpoch) return;

    const animation = await decodeAnimatedWebp(bytes);
    if (myEpoch !== navEpoch) {
      animation?.dispose?.();
      return;
    }

    if (animation) {
      nativeImageHost.clear();
      gifHost.play(animation);
      return;
    }

    painter.clear();
    nativeImageHost.showBytes(bytes, 'image/webp');
  } catch (err) {
    console.warn('[render] webp failed:', filePath, err);
    if (myEpoch === navEpoch) painter.clear();
  }
}

async function renderStatic(filePath: string, myEpoch: number): Promise<void> {
  try {
    let bitmap: ImageBitmap | null = null;
    const cached = governor.get(filePath);
    if (cached) {
      bitmap = cached.bitmap as unknown as ImageBitmap;
    } else {
      bitmap = await preloader.fetchAndDecode(filePath, albumEpoch);
    }
    if (myEpoch !== navEpoch) return;
    if (bitmap) painter.drawImage(bitmap);
  } catch (err) {
    console.warn('[render] static failed:', filePath, err);
    if (myEpoch === navEpoch) painter.clear();
  }
}

async function renderGif(current: AlbumEntryDTO, myEpoch: number): Promise<void> {
  const filePath = current.path;
  try {
    if (shouldUseNativeGif(current)) {
      await showNativePath(filePath, myEpoch);
      return;
    }

    const bytes = await window.api.readFile(filePath);
    if (myEpoch !== navEpoch) return;
    if (bytes.byteLength > MAX_NATIVE_GIF_BYTES) {
      nativeImageHost.showBytes(bytes, 'image/gif');
      return;
    }
    const cleanBuf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const workerUrl = new URL('workers/gif-decoder.worker.js', document.baseURI).toString();
    if (activeGifWorker) {
      activeGifWorker.terminate();
      activeGifWorker = null;
    }
    const worker = new Worker(workerUrl, { type: 'classic' });
    activeGifWorker = worker;
    const parsed = await new Promise<{ frames: ImageBitmap[]; delays: number[] } | null>(
      (resolve) => {
        worker.onmessage = (ev: MessageEvent) => {
          const data = ev.data;
          if (data?.type === 'parsed') {
            resolve({ frames: data.frames as ImageBitmap[], delays: data.delays as number[] });
          } else if (data?.type === 'error') {
            console.warn('[gif worker]', data.message);
            resolve(null);
          }
        };
        worker.onerror = (e) => {
          console.warn('[gif worker error]', e);
          resolve(null);
        };
        worker.postMessage({ type: 'parse', buffer: cleanBuf }, [cleanBuf]);
      },
    );
    if (myEpoch !== navEpoch || activeGifWorker !== worker) {
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      return;
    }
    if (parsed && parsed.frames.length > 0) {
      gifHost.play({ ...parsed, dispose: () => disposeFrames(parsed.frames) });
    }
  } catch (err) {
    console.warn('[render] gif failed:', filePath, err);
  }
}

installKeyboard({
  onPrev: () => {
    bumpEpoch();
    album.prev();
    void renderCurrent();
  },
  onNext: () => {
    bumpEpoch();
    album.next();
    void renderCurrent();
  },
  onFullscreen: () => {
    void window.api.toggleFullscreen();
  },
  onSpeedDown: () => {
    speedHud.show(gifHost.bumpSpeed(-0.1));
  },
  onSpeedUp: () => {
    speedHud.show(gifHost.bumpSpeed(+0.1));
  },
  onExit: () => {
    void window.api.quitApp();
  },
  isExitBlocked: () => sortDialog.isOpen(),
});

window.api.onAlbumLoad((payload) => {
  albumEpoch += 1;
  bumpEpoch();
  // New album: evict everything from prior session.
  governor.evictAll();
  album.load(payload.folder, payload.entries, payload.currentIndex);
  void renderCurrent();
  // Then kick off background preload of every static path in the album.
  preloader.scheduleAll(album.entries(), albumEpoch, ({ completed, total }) => {
    progressToast.update({ phase: 'preloading', completed, total });
  });
});

window.api.onAlbumProgress((payload) => {
  // Measure-phase progress emitted by main; preload-phase comes from local
  // preloader.scheduleAll above. Both flow into the same toast.
  progressToast.update({
    phase: payload.phase,
    completed: payload.completed,
    total: payload.total,
    bytesSoFar: payload.bytesSoFar,
  });
});

window.api.onSortRequest(() => {
  const current = album.current() ?? '';
  sortDialog.open(album.entries(), current);
});

// expose for debugging (dev only)
(window as unknown as { __viewer: unknown }).__viewer = {
  album,
  governor,
  painter,
  gifHost,
  nativeImageHost,
  sortDialog,
};
