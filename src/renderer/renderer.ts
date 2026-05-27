/**
 * renderer.ts — bootstraps the renderer process.
 *
 * Wires together album state, static preload, animated prepared preload,
 * keyboard/menu input, and minimal dialogs.
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
import { SettingsDialog } from './settings-dialog';
import { mediaKindForEntry } from './media-kind';
import { NativeImageHost } from './native-image-host';
import { decodeAnimatedWebp } from './animated-webp-decoder';
import { disposeFrames } from './animation-disposal';
import { SpeedHud } from './speed-hud';
import { MAX_NATIVE_GIF_BYTES } from './animation-policy';
import { PreparedMediaCache, type PreparedMedia } from './prepared-media-cache';
import { AnimatedMediaPreloader } from './animated-media-preloader';
import type { AlbumEntryDTO } from '../preload/api';
import {
  DEFAULT_USER_PREFERENCES,
  normalizePreferences,
  type UserPreferences,
} from '../shared/user-preferences';

const canvasEl = document.getElementById('canvas') as HTMLCanvasElement;
const fallbackImg = document.getElementById('fallback-gif') as HTMLImageElement;
const toastHost = document.getElementById('toast-host') as HTMLElement;
const dialogHost = document.getElementById('dialog-host') as HTMLElement;

const painter = new CanvasPainter(canvasEl);
const album = new Album();
const governor = new CacheGovernor({
  maxEntries: Number.MAX_SAFE_INTEGER,
  maxBytes: Number.MAX_SAFE_INTEGER,
});
const preloader = new PreloadQueue(governor);
const gifHost = new GifHost(painter, (s) => pushSpeed(s));
const nativeImageHost = new NativeImageHost(fallbackImg);
let currentPreferences: UserPreferences = DEFAULT_USER_PREFERENCES;
const preparedMediaCache = new PreparedMediaCache(
  currentPreferences.preload.animatedMemoryLimitBytes,
);
const animatedPreloader = new AnimatedMediaPreloader(preparedMediaCache, prepareAnimatedMedia);

const rssToast = new RssToast(toastHost);
rssToast.install();
const progressToast = new ProgressToast(toastHost);
const speedHud = new SpeedHud(toastHost);

const sortDialog = new SortDialog(dialogHost, {
  onSortChange: (entries, newIdx) => {
    album.reorder(entries, newIdx);
    bumpEpoch();
    updatePreparedOrder();
    scheduleAnimatedPreload();
    void renderCurrent();
  },
  onJumpTo: (idx) => {
    if (idx < 0 || idx >= album.size()) return;
    album.state.currentIndex = idx;
    bumpEpoch();
    updatePreparedOrder();
    scheduleAnimatedPreload();
    void renderCurrent();
  },
});

const settingsDialog = new SettingsDialog(dialogHost, {
  onSavePreloadLimit: async (bytes) => {
    const prefs = normalizePreferences(await window.api.updateAnimatedPreloadMemoryLimit(bytes));
    applyPreferences(prefs);
    return prefs;
  },
});

installContextMenu(() => gifHost.speedMultiplier);

async function applySavedPreferences(): Promise<void> {
  try {
    applyPreferences(normalizePreferences(await window.api.getPreferences()));
  } catch (err) {
    console.warn('[preferences] failed to load:', err);
  }
}

void applySavedPreferences();

function applyPreferences(prefs: UserPreferences): void {
  currentPreferences = prefs;
  gifHost.speedMultiplier = prefs.animation.speedMultiplier;
  preparedMediaCache.setLimit(prefs.preload.animatedMemoryLimitBytes, { protectCurrent: true });
  scheduleAnimatedPreload({ protectCurrent: true });
}

let navEpoch = 0;
let albumEpoch = 0;
function bumpEpoch(): number {
  navEpoch += 1;
  return navEpoch;
}
preloader.setEpochSupplier(() => albumEpoch);

let activeGifWorker: Worker | null = null;

function stopActiveAnimation(): void {
  gifHost.stop();
  if (activeGifWorker) {
    activeGifWorker.terminate();
    activeGifWorker = null;
  }
}

function clearAllSurfaces(): void {
  stopActiveAnimation();
  nativeImageHost.clear();
  painter.clear();
}

async function renderCurrent(): Promise<void> {
  const myEpoch = navEpoch;
  const current = album.currentEntry();
  if (!current) {
    clearAllSurfaces();
    return;
  }

  switch (mediaKindForEntry(current)) {
    case 'animated-gif':
      await renderPreparedOrGif(current, myEpoch);
      break;
    case 'webp':
      await renderPreparedOrWebp(current, myEpoch);
      break;
    case 'static-bitmap':
      await renderStatic(current.path, myEpoch);
      break;
  }
}

async function showNativePath(filePath: string, myEpoch: number): Promise<void> {
  const url = await window.api.fileUrl(filePath);
  if (myEpoch !== navEpoch) return;
  stopActiveAnimation();
  nativeImageHost.showUrl(url);
  painter.clear();
}

async function renderPreparedOrGif(current: AlbumEntryDTO, myEpoch: number): Promise<void> {
  const prepared = await animatedPreloader.ensure(current, album.index());
  if (myEpoch !== navEpoch) return;
  if (prepared) {
    commitPreparedMedia(prepared);
    return;
  }
  await renderGif(current, myEpoch);
}

async function renderPreparedOrWebp(current: AlbumEntryDTO, myEpoch: number): Promise<void> {
  const prepared = await animatedPreloader.ensure(current, album.index());
  if (myEpoch !== navEpoch) return;
  if (prepared) {
    commitPreparedMedia(prepared);
    return;
  }
  await renderWebp(current, myEpoch);
}

function commitPreparedMedia(media: PreparedMedia): void {
  if (media.kind === 'animation') {
    stopActiveAnimation();
    nativeImageHost.clear();
    gifHost.play({ frames: media.frames, delays: media.delays });
    return;
  }

  stopActiveAnimation();
  nativeImageHost.showUrl(media.url);
  painter.clear();
}

async function renderWebp(current: AlbumEntryDTO, myEpoch: number): Promise<void> {
  const filePath = current.path;
  try {
    if (shouldPrepareNative(current)) {
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
      stopActiveAnimation();
      nativeImageHost.clear();
      gifHost.play(animation);
      return;
    }

    stopActiveAnimation();
    nativeImageHost.showBytes(bytes, 'image/webp');
    painter.clear();
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
    if (bitmap) {
      stopActiveAnimation();
      nativeImageHost.clear();
      painter.drawImage(bitmap);
    }
  } catch (err) {
    console.warn('[render] static failed:', filePath, err);
    if (myEpoch === navEpoch) painter.clear();
  }
}

async function renderGif(current: AlbumEntryDTO, myEpoch: number): Promise<void> {
  const filePath = current.path;
  try {
    if (shouldPrepareNative(current)) {
      await showNativePath(filePath, myEpoch);
      return;
    }

    const bytes = await window.api.readFile(filePath);
    if (myEpoch !== navEpoch) return;
    if (bytes.byteLength > MAX_NATIVE_GIF_BYTES) {
      stopActiveAnimation();
      nativeImageHost.showBytes(bytes, 'image/gif');
      painter.clear();
      return;
    }

    const parsed = await decodeGifBytes(bytes);
    if (myEpoch !== navEpoch) {
      if (parsed) disposeFrames(parsed.frames);
      return;
    }
    if (parsed && parsed.frames.length > 0) {
      stopActiveAnimation();
      nativeImageHost.clear();
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
    updatePreparedOrder();
    scheduleAnimatedPreload();
    void renderCurrent();
  },
  onNext: () => {
    bumpEpoch();
    album.next();
    updatePreparedOrder();
    scheduleAnimatedPreload();
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
  isExitBlocked: () => sortDialog.isOpen() || settingsDialog.isOpen(),
});

window.api.onAlbumLoad((payload) => {
  albumEpoch += 1;
  bumpEpoch();
  governor.evictAll();
  preparedMediaCache.clear();
  animatedPreloader.clear();
  album.load(payload.folder, payload.entries, payload.currentIndex);
  updatePreparedOrder();
  void renderCurrent();
  preloader.scheduleAll(album.entries(), albumEpoch, ({ completed, total }) => {
    progressToast.update({ phase: 'preloading', completed, total });
  });
  scheduleAnimatedPreload();
});

window.api.onAlbumProgress((payload) => {
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

window.api.onSettingsRequest(() => {
  settingsDialog.open(currentPreferences);
});

(window as unknown as { __viewer: unknown }).__viewer = {
  album,
  governor,
  painter,
  gifHost,
  nativeImageHost,
  preparedMediaCache,
  animatedPreloader,
  sortDialog,
  settingsDialog,
};

function updatePreparedOrder(): void {
  preparedMediaCache.setOrder(album.entries().map((entry) => entry.path));
  preparedMediaCache.setCurrentIndex(album.index());
}

function scheduleAnimatedPreload(options: { protectCurrent?: boolean } = {}): void {
  if (album.size() === 0) return;
  void animatedPreloader
    .schedule(album.entries(), album.index(), options)
    .catch((err) => console.warn('[animated preload] failed:', err));
}

function shouldPrepareNative(entry: AlbumEntryDTO): boolean {
  const allFrames = entry.allFramesDecodedBytes;
  if (typeof allFrames === 'number' && allFrames > preparedMediaCache.limitBytes()) return true;
  const encoded = entry.encodedBytes;
  return typeof encoded === 'number' && encoded > MAX_NATIVE_GIF_BYTES;
}

async function prepareAnimatedMedia(entry: AlbumEntryDTO): Promise<PreparedMedia | null> {
  try {
    if (shouldPrepareNative(entry)) return await prepareNativeMedia(entry);

    if (mediaKindForEntry(entry) === 'animated-gif') {
      const bytes = await window.api.readFile(entry.path);
      if (bytes.byteLength > MAX_NATIVE_GIF_BYTES) return await prepareNativeMedia(entry);
      const decoded = await decodeGifBytes(bytes);
      if (!decoded || decoded.frames.length === 0) return await prepareNativeMedia(entry);
      const decodedBytes =
        decoded.totalBytes || estimateAnimationBytes(entry, decoded.frames.length);
      if (decodedBytes > preparedMediaCache.limitBytes()) {
        disposeFrames(decoded.frames);
        return await prepareNativeMedia(entry);
      }
      return {
        kind: 'animation',
        path: entry.path,
        bytes: decodedBytes,
        frames: decoded.frames,
        delays: decoded.delays,
        dispose: () => disposeFrames(decoded.frames),
      };
    }

    const bytes = await window.api.readFile(entry.path);
    const animation = await decodeAnimatedWebp(bytes);
    if (!animation) return await prepareNativeMedia(entry);
    const bytesEstimate = estimateAnimationBytes(entry, animation.frames.length);
    if (bytesEstimate > preparedMediaCache.limitBytes()) {
      animation.dispose?.();
      return await prepareNativeMedia(entry);
    }
    return {
      kind: 'animation',
      path: entry.path,
      bytes: bytesEstimate,
      frames: animation.frames,
      delays: animation.delays,
      dispose: animation.dispose,
    };
  } catch (err) {
    console.warn('[animated preload] prepare failed:', entry.path, err);
    return null;
  }
}

async function prepareNativeMedia(entry: AlbumEntryDTO): Promise<PreparedMedia | null> {
  const url = await window.api.fileUrl(entry.path);
  await waitForNativeImageReady(url);
  return {
    kind: 'native',
    path: entry.path,
    url,
    bytes: Math.max(1, entry.encodedBytes ?? 1),
  };
}

async function waitForNativeImageReady(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  if (typeof img.decode === 'function') {
    await img.decode();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('native image failed to load'));
  });
}

function estimateAnimationBytes(entry: AlbumEntryDTO, frameCount: number): number {
  if (typeof entry.allFramesDecodedBytes === 'number' && entry.allFramesDecodedBytes > 0) {
    return entry.allFramesDecodedBytes;
  }
  if (entry.width && entry.height) return entry.width * entry.height * 4 * frameCount;
  return Math.max(1, entry.encodedBytes ?? 1);
}

async function decodeGifBytes(
  bytes: Uint8Array,
): Promise<{ frames: ImageBitmap[]; delays: number[]; totalBytes: number } | null> {
  const cleanBuf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const workerUrl = new URL('workers/gif-decoder.worker.js', document.baseURI).toString();
  const worker = new Worker(workerUrl, { type: 'classic' });
  return await new Promise((resolve) => {
    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data?.type === 'parsed') {
        worker.terminate();
        resolve({
          frames: data.frames as ImageBitmap[],
          delays: data.delays as number[],
          totalBytes: Number(data.totalBytes ?? 0),
        });
      } else if (data?.type === 'error') {
        worker.terminate();
        console.warn('[gif worker]', data.message);
        resolve(null);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      console.warn('[gif worker error]', e);
      resolve(null);
    };
    worker.postMessage({ type: 'parse', buffer: cleanBuf }, [cleanBuf]);
  });
}
