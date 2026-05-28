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
import { PositionHud } from './position-hud';
import { PreloadPanel, type PreloadPanelItem, type PreloadPanelItemKind } from './preload-panel';
import { MAX_NATIVE_GIF_BYTES } from './animation-policy';
import { PreparedMediaCache, type PreparedMedia } from './prepared-media-cache';
import {
  AnimatedMediaPreloader,
  type AnimatedMediaPrepareContext,
} from './animated-media-preloader';
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
  maxBytes: DEFAULT_USER_PREFERENCES.preload.animatedMemoryLimitBytes,
});
const preloader = new PreloadQueue(governor);
const gifHost = new GifHost(painter, (s) => pushSpeed(s));
const nativeImageHost = new NativeImageHost(fallbackImg);
let currentPreferences: UserPreferences = DEFAULT_USER_PREFERENCES;
const preparedMediaCache = new PreparedMediaCache(
  currentPreferences.preload.animatedMemoryLimitBytes,
);
const animatedPreloader = new AnimatedMediaPreloader(preparedMediaCache, prepareAnimatedMedia, {
  onChange: () => refreshPreloadPanel(),
});

const rssToast = new RssToast(toastHost);
rssToast.install();
const progressToast = new ProgressToast(toastHost);
const speedHud = new SpeedHud(toastHost);
const positionHud = new PositionHud(toastHost);
const preloadPanel = new PreloadPanel(dialogHost);

const sortDialog = new SortDialog(dialogHost, {
  onSortChange: (entries, newIdx) => {
    album.reorder(entries, newIdx);
    bumpEpoch();
    updatePreparedOrder();
    showPositionHud();
    refreshPreloadPanel({ reveal: true });
    schedulePreloads();
    void renderCurrent();
  },
  onJumpTo: (idx) => {
    if (idx < 0 || idx >= album.size()) return;
    album.state.currentIndex = idx;
    bumpEpoch();
    updatePreparedOrder();
    showPositionHud();
    refreshPreloadPanel({ reveal: true });
    schedulePreloads();
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
  applyPlannedPreloadBudgets({ protectCurrent: true });
  schedulePreloads({ protectCurrent: true });
}

let navEpoch = 0;
let albumEpoch = 0;
function bumpEpoch(): number {
  navEpoch += 1;
  return navEpoch;
}
preloader.setEpochSupplier(() => albumEpoch);

function stopActiveAnimation(): void {
  gifHost.stop();
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
  await showNativeUrl(url, myEpoch);
}

async function renderPreparedOrGif(current: AlbumEntryDTO, myEpoch: number): Promise<void> {
  const prepared = preparedMediaCache.get(current.path);
  if (prepared) {
    await commitPreparedMedia(prepared, myEpoch);
    return;
  }
  await renderGif(current, myEpoch);
}

async function renderPreparedOrWebp(current: AlbumEntryDTO, myEpoch: number): Promise<void> {
  const prepared = await animatedPreloader.ensure(current, album.index(), {
    estimatedBytes: estimatePreparedMediaBytes(current),
    protectCurrent: true,
    reason: 'current',
  });
  if (myEpoch !== navEpoch) return;
  if (prepared) {
    await commitPreparedMedia(prepared, myEpoch);
    return;
  }
  await renderWebp(current, myEpoch);
}

async function commitPreparedMedia(media: PreparedMedia, myEpoch: number): Promise<void> {
  if (media.kind === 'animation') {
    stopActiveAnimation();
    nativeImageHost.clear();
    const cacheOwned = preparedMediaCache.has(media.path);
    const playable = cacheOwned ? preparedMediaCache.toPlayable(media.path) : media;
    if (playable) gifHost.play(playable);
    return;
  }

  await showNativeUrl(media.url, myEpoch);
}

async function showNativeUrl(url: string, myEpoch: number): Promise<void> {
  const loaded = await nativeImageHost.showUrlWhenReady(url);
  if (myEpoch !== navEpoch) {
    if (loaded) nativeImageHost.clear();
    return;
  }
  if (!loaded) {
    return;
  }
  stopActiveAnimation();
  painter.clear();
  refreshPreloadPanel();
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
    await showNativePath(filePath, myEpoch);
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
      refreshPreloadPanel();
    }
  } catch (err) {
    console.warn('[render] static failed:', filePath, err);
    if (myEpoch === navEpoch) painter.clear();
  }
}

async function renderGif(current: AlbumEntryDTO, myEpoch: number): Promise<void> {
  const filePath = current.path;
  const nativePlayback = showNativePath(filePath, myEpoch).catch((err) => {
    console.warn('[render] gif native playback failed:', filePath, err);
  });
  try {
    if (shouldPrepareNative(current)) {
      await nativePlayback;
      return;
    }

    const bytes = await window.api.readFile(filePath);
    if (myEpoch !== navEpoch) return;
    if (bytes.byteLength > MAX_NATIVE_GIF_BYTES) {
      await nativePlayback;
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
      return;
    }
    await nativePlayback;
  } catch (err) {
    console.warn('[render] gif failed:', filePath, err);
  }
}

installKeyboard({
  onPrev: () => {
    bumpEpoch();
    album.prev();
    updatePreparedOrder();
    showPositionHud();
    refreshPreloadPanel({ reveal: true });
    schedulePreloads();
    void renderCurrent();
  },
  onNext: () => {
    bumpEpoch();
    album.next();
    updatePreparedOrder();
    showPositionHud();
    refreshPreloadPanel({ reveal: true });
    schedulePreloads();
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
  showPositionHud();
  refreshPreloadPanel({ reveal: true });
  void renderCurrent();
  schedulePreloads();
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
  positionHud,
  preloadPanel,
  sortDialog,
  settingsDialog,
};

function updatePreparedOrder(): void {
  const paths = album.entries().map((entry) => entry.path);
  preparedMediaCache.setOrder(paths);
  preparedMediaCache.setCurrentIndex(album.index());
  governor.setOrder(paths);
  governor.setCurrentIndex(album.index());
  refreshPreloadPanel();
}

interface PreloadBudgetPlan {
  allowedPaths: Set<string>;
  staticBytes: number;
  animatedBytes: number;
}

interface ScheduleAnimatedPreloadOptions {
  protectCurrent?: boolean;
  allowedPaths?: Set<string>;
}

function schedulePreloads(options: { protectCurrent?: boolean } = {}): void {
  if (album.size() === 0) return;
  const plan = applyPlannedPreloadBudgets(options);
  preloader.scheduleAll(
    album.entries(),
    albumEpoch,
    ({ completed, total }) => {
      progressToast.update({ phase: 'preloading', completed, total });
      refreshPreloadPanel();
    },
    { currentIndex: album.index(), allowedPaths: plan.allowedPaths },
  );
  scheduleAnimatedPreload({
    ...options,
    allowedPaths: plan.allowedPaths,
  });
}

function applyPlannedPreloadBudgets(options: { protectCurrent?: boolean } = {}): PreloadBudgetPlan {
  const plan = planPreloadBudget();
  if (album.size() === 0) {
    governor.setLimit(currentPreferences.preload.animatedMemoryLimitBytes);
    preparedMediaCache.setLimit(currentPreferences.preload.animatedMemoryLimitBytes, options);
    return plan;
  }
  governor.setLimit(plan.staticBytes);
  preparedMediaCache.setLimit(plan.animatedBytes, options);
  return plan;
}

function planPreloadBudget(): PreloadBudgetPlan {
  const entries = album.entries();
  const totalLimit = currentPreferences.preload.animatedMemoryLimitBytes;
  const plan: PreloadBudgetPlan = {
    allowedPaths: new Set<string>(),
    staticBytes: 0,
    animatedBytes: 0,
  };
  if (entries.length === 0) return plan;

  const currentIndex = album.index();
  const candidates = entries
    .map((entry, index) => ({
      entry,
      index,
      kind: preloadBudgetKind(entry),
      bytes: estimatePreloadEntryBytes(entry, totalLimit),
    }))
    .filter(
      (
        item,
      ): item is {
        entry: AlbumEntryDTO;
        index: number;
        kind: 'static' | 'animated';
        bytes: number;
      } => item.kind !== null && item.bytes !== null,
    )
    .sort(
      (a, b) =>
        wrapDistance(a.index, currentIndex, entries.length) -
          wrapDistance(b.index, currentIndex, entries.length) || a.index - b.index,
    );

  let plannedBytes = 0;
  for (const candidate of candidates) {
    if (candidate.bytes > totalLimit) continue;
    if (plannedBytes + candidate.bytes > totalLimit) continue;
    plannedBytes += candidate.bytes;
    plan.allowedPaths.add(candidate.entry.path);
    if (candidate.kind === 'static') {
      plan.staticBytes += candidate.bytes;
    } else {
      plan.animatedBytes += candidate.bytes;
    }
  }
  return plan;
}

function preloadBudgetKind(entry: AlbumEntryDTO): 'static' | 'animated' | null {
  const kind = mediaKindForEntry(entry);
  if (kind === 'static-bitmap') return 'static';
  if (kind === 'animated-gif' || kind === 'webp') return 'animated';
  return null;
}

function estimatePreloadEntryBytes(entry: AlbumEntryDTO, limitBytes: number): number | null {
  if (preloadBudgetKind(entry) === 'static') {
    if (isFinitePositive(entry.estimatedBytes)) return Math.ceil(entry.estimatedBytes);
    if (entry.width && entry.height) return entry.width * entry.height * 4;
    return Math.max(1, entry.encodedBytes ?? 1);
  }
  return estimatePreparedMediaBytesForLimit(entry, limitBytes);
}

function wrapDistance(index: number, currentIndex: number, total: number): number {
  if (total <= 0) return 0;
  const delta = Math.abs(index - currentIndex);
  return Math.min(delta, total - delta);
}

function scheduleAnimatedPreload(options: ScheduleAnimatedPreloadOptions = {}): void {
  if (album.size() === 0) return;
  void animatedPreloader
    .schedule(album.entries(), album.index(), {
      ...options,
      estimateBytes: estimatePreparedMediaBytes,
    })
    .catch((err) => console.warn('[animated preload] failed:', err));
}

function showPositionHud(): void {
  positionHud.show({
    index: album.index(),
    total: album.size(),
    path: album.current(),
  });
}

function refreshPreloadPanel(options: { reveal?: boolean } = {}): void {
  preloadPanel.update(
    {
      currentIndex: album.index(),
      total: album.size(),
      items: buildPreloadPanelItems(),
    },
    options,
  );
}

function buildPreloadPanelItems(): PreloadPanelItem[] {
  const entries = album.entries();
  const total = entries.length;
  if (total === 0) return [];
  const currentIndex = album.index();
  const offsets = nearbyOffsets(total);
  const items: PreloadPanelItem[] = [];

  for (const offset of offsets) {
    const index = wrapIndex(currentIndex + offset, total);
    const entry = entries[index];
    if (!entry) continue;
    const isCurrent = index === currentIndex;
    const animatedKind = preparedMediaCache.kindFor(entry.path);
    const isStaticReady = governor.has(entry.path);
    const isLoading = animatedPreloader.isPreparing(entry.path);
    if (!isCurrent && !animatedKind && !isStaticReady && !isLoading) continue;
    items.push({
      index,
      path: entry.path,
      state: isCurrent ? 'current' : isLoading ? 'loading' : 'ready',
      kind: preloadPanelKind(entry, animatedKind, isStaticReady),
    });
  }

  return items;
}

function nearbyOffsets(total: number): number[] {
  const raw = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8];
  const seen = new Set<number>();
  const offsets: number[] = [];
  for (const offset of raw) {
    const normalized = wrapIndex(offset, total);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    offsets.push(offset);
  }
  return offsets;
}

function wrapIndex(index: number, total: number): number {
  return ((index % total) + total) % total;
}

function preloadPanelKind(
  entry: AlbumEntryDTO,
  animatedKind: PreparedMedia['kind'] | null,
  isStaticReady: boolean,
): PreloadPanelItemKind {
  if (animatedKind === 'animation') return 'animation';
  if (animatedKind === 'native') return 'native';
  if (isStaticReady || mediaKindForEntry(entry) === 'static-bitmap') return 'static';
  return 'animation';
}

function shouldPrepareNative(entry: AlbumEntryDTO): boolean {
  return shouldPrepareNativeWithin(entry, preparedMediaCache.limitBytes());
}

function shouldPrepareNativeWithin(entry: AlbumEntryDTO, limitBytes: number): boolean {
  const allFrames = entry.allFramesDecodedBytes;
  if (typeof allFrames === 'number' && allFrames > limitBytes) return true;
  const encoded = entry.encodedBytes;
  return typeof encoded === 'number' && encoded > MAX_NATIVE_GIF_BYTES;
}

async function prepareAnimatedMedia(
  entry: AlbumEntryDTO,
  context?: AnimatedMediaPrepareContext,
): Promise<PreparedMedia | null> {
  const signal = context?.signal;
  try {
    if (signal?.aborted) return null;
    if (shouldPrepareNative(entry)) return await prepareNativeMedia(entry);

    if (mediaKindForEntry(entry) === 'animated-gif') {
      const bytes = await window.api.readFile(entry.path);
      if (signal?.aborted) return null;
      if (bytes.byteLength > MAX_NATIVE_GIF_BYTES) return await prepareNativeMedia(entry);
      const decoded = await decodeGifBytes(bytes, {
        signal,
        maxDecodedBytes: preparedMediaCache.limitBytes(),
      });
      if (signal?.aborted) {
        if (decoded) disposeFrames(decoded.frames);
        return null;
      }
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
    if (signal?.aborted) return null;
    const animation = await decodeAnimatedWebp(bytes, {
      signal,
      maxDecodedBytes: preparedMediaCache.limitBytes(),
    });
    if (signal?.aborted) {
      animation?.dispose?.();
      return null;
    }
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
  return {
    kind: 'native',
    path: entry.path,
    url,
    bytes: Math.max(1, entry.encodedBytes ?? 1),
  };
}

function estimateAnimationBytes(entry: AlbumEntryDTO, frameCount: number): number {
  if (typeof entry.allFramesDecodedBytes === 'number' && entry.allFramesDecodedBytes > 0) {
    return entry.allFramesDecodedBytes;
  }
  if (entry.width && entry.height) return entry.width * entry.height * 4 * frameCount;
  return Math.max(1, entry.encodedBytes ?? 1);
}

function estimatePreparedMediaBytes(entry: AlbumEntryDTO): number | null {
  return estimatePreparedMediaBytesForLimit(entry, preparedMediaCache.limitBytes());
}

function estimatePreparedMediaBytesForLimit(
  entry: AlbumEntryDTO,
  limitBytes: number,
): number | null {
  if (!isFinitePositive(entry.encodedBytes) && !isFinitePositive(entry.allFramesDecodedBytes)) {
    return null;
  }
  if (shouldPrepareNativeWithin(entry, limitBytes)) return Math.max(1, entry.encodedBytes ?? 1);
  if (isFinitePositive(entry.allFramesDecodedBytes)) return entry.allFramesDecodedBytes!;
  if (entry.width && entry.height && entry.frameCount) {
    return estimateAnimationBytes(entry, entry.frameCount);
  }
  return Math.max(1, entry.encodedBytes ?? 1);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

async function decodeGifBytes(
  bytes: Uint8Array,
  options: { signal?: AbortSignal; maxDecodedBytes?: number } = {},
): Promise<{ frames: ImageBitmap[]; delays: number[]; totalBytes: number } | null> {
  if (options.signal?.aborted) return null;
  const cleanBuf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const workerUrl = new URL('workers/gif-decoder.worker.js', document.baseURI).toString();
  const worker = new Worker(workerUrl, { type: 'classic' });
  return await new Promise((resolve) => {
    const cleanup = (): void => {
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (
      parsed: { frames: ImageBitmap[]; delays: number[]; totalBytes: number } | null,
    ): void => {
      cleanup();
      resolve(parsed);
    };
    const onAbort = (): void => {
      worker.terminate();
      finish(null);
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data?.type === 'parsed') {
        worker.terminate();
        finish({
          frames: data.frames as ImageBitmap[],
          delays: data.delays as number[],
          totalBytes: Number(data.totalBytes ?? 0),
        });
      } else if (data?.type === 'error') {
        worker.terminate();
        console.warn('[gif worker]', data.message);
        finish(null);
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      console.warn('[gif worker error]', e);
      finish(null);
    };
    worker.postMessage(
      {
        type: 'parse',
        buffer: cleanBuf,
        maxDecodedBytes: options.maxDecodedBytes,
      },
      [cleanBuf],
    );
  });
}
