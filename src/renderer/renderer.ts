/**
 * renderer.ts — bootstraps the renderer process.
 *
 * Wires together:
 *   - Album state
 *   - CanvasPainter
 *   - CacheGovernor + PreloadQueue
 *   - Input dispatch
 *   - GifHost
 *   - Context menu host
 *   - RSS toast
 */

import { Album } from './album';
import { CanvasPainter } from './canvas';
import { CacheGovernor } from './cache-governor';
import { PreloadQueue } from './preload-queue';
import { installKeyboard } from './input';
import { GifHost } from './gif-host';
import { installContextMenu, pushSpeed } from './menu-host';
import { RssToast } from './toast';

const GIF_FALLBACK_BYTES = 100 * 1024 * 1024;

const canvasEl = document.getElementById('canvas') as HTMLCanvasElement;
const fallbackImg = document.getElementById('fallback-gif') as HTMLImageElement;
const toastHost = document.getElementById('toast-host') as HTMLElement;

const painter = new CanvasPainter(canvasEl);
const album = new Album();
const governor = new CacheGovernor();
const preloader = new PreloadQueue(governor);
const gifHost = new GifHost(painter, (s) => pushSpeed(s));

const toast = new RssToast(toastHost);
toast.install();

installContextMenu(() => gifHost.speedMultiplier);

// Navigation epoch — incremented on every navigation event (album-load,
// prev, next). All async render/preload paths capture the epoch at entry
// and re-check before mutating UI; stale resolutions are discarded.
let navEpoch = 0;
function bumpEpoch(): number {
  navEpoch += 1;
  return navEpoch;
}
preloader.setEpochSupplier(() => navEpoch);

let activeGifWorker: Worker | null = null;

function clearGif(): void {
  gifHost.stop();
  if (activeGifWorker) {
    activeGifWorker.terminate();
    activeGifWorker = null;
  }
  fallbackImg.classList.remove('active');
  fallbackImg.removeAttribute('src');
}

function isGifPath(p: string): boolean {
  return p.toLowerCase().endsWith('.gif');
}

async function renderCurrent(): Promise<void> {
  const myEpoch = navEpoch;
  const current = album.current();
  if (!current) {
    painter.clear();
    return;
  }
  clearGif();
  if (isGifPath(current)) {
    await renderGif(current, myEpoch);
  } else {
    await renderStatic(current, myEpoch);
  }
  if (myEpoch !== navEpoch) return; // stale: do not schedule preload
  // Schedule preload for surrounding entries.
  preloader.schedule(album.state.paths, album.index(), myEpoch);
}

async function renderStatic(filePath: string, myEpoch: number): Promise<void> {
  try {
    let bitmap: ImageBitmap | null = null;
    const cached = governor.get(filePath);
    if (cached) {
      bitmap = cached.bitmap as unknown as ImageBitmap;
    } else {
      bitmap = await preloader.fetchAndDecode(filePath, myEpoch);
    }
    if (myEpoch !== navEpoch) return; // stale: bail without drawing
    if (bitmap) painter.drawImage(bitmap);
  } catch (err) {
    console.warn('[render] static failed:', filePath, err);
    if (myEpoch === navEpoch) painter.clear();
  }
}

async function renderGif(filePath: string, myEpoch: number): Promise<void> {
  try {
    const bytes = await window.api.readFile(filePath);
    if (myEpoch !== navEpoch) return; // stale: drop result
    // Slice to a clean ArrayBuffer (not SharedArrayBuffer) for Blob/transfer.
    const cleanBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    if (bytes.byteLength > GIF_FALLBACK_BYTES) {
      // Fallback to native <img> for very large GIFs; no speed control.
      const blob = new Blob([cleanBuf], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      fallbackImg.src = url;
      fallbackImg.classList.add('active');
      return;
    }
    // Resolve the worker URL relative to the renderer's HTML base.
    const workerUrl = new URL('workers/gif-decoder.worker.js', document.baseURI).toString();
    // Atomic-ish worker swap: terminate any prior worker FIRST, then
    // assign the new one so a later stale reply can be detected by
    // comparing against `activeGifWorker`.
    if (activeGifWorker) {
      activeGifWorker.terminate();
      activeGifWorker = null;
    }
    const worker = new Worker(workerUrl, { type: 'classic' });
    activeGifWorker = worker;
    const parsed = await new Promise<{ frames: ImageBitmap[]; delays: number[] } | null>((resolve) => {
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
      // Transfer the cleaned buffer for zero-copy.
      worker.postMessage({ type: 'parse', buffer: cleanBuf }, [cleanBuf]);
    });
    // Two guards: epoch must still match AND the worker we awaited must
    // still be the active worker. If either fails, bail safely.
    if (myEpoch !== navEpoch || activeGifWorker !== worker) {
      try { worker.terminate(); } catch { /* ignore */ }
      return;
    }
    if (parsed && parsed.frames.length > 0) {
      gifHost.play(parsed);
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
    gifHost.bumpSpeed(-0.1);
  },
  onSpeedUp: () => {
    gifHost.bumpSpeed(+0.1);
  },
});

window.api.onAlbumLoad((payload) => {
  bumpEpoch();
  album.load(payload.folder, payload.images, payload.currentIndex);
  void renderCurrent();
});

// expose for debugging (dev only)
(window as unknown as { __viewer: unknown }).__viewer = { album, governor, painter, gifHost };
