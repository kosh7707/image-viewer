/**
 * preload-queue.ts — fetch+decode every static image in the album.
 *
 * Cache policy v2: no sliding window. The album-loader gates total RAM via
 * the 4 GB confirm dialog, so the queue simply enqueues every path the
 * caller hands it, skipping entries already cached or in flight. GIFs are
 * skipped here; they go through the dedicated worker pipeline.
 *
 * Each decoded entry is admitted to the CacheGovernor, then GPU-pre-warmed
 * via a 1x1 drawImage to a hidden OffscreenCanvas so subsequent navigations
 * paint without a texture-upload stall.
 *
 * Optionally a concurrency limit keeps disk IO from being saturated by
 * thousands of simultaneous reads; default 8 fetches in flight.
 */

import { CacheGovernor } from './cache-governor';
import { extOfPath, isPreloadableBitmapPath } from './media-kind';

const DEFAULT_CONCURRENCY = 8;

function mimeFor(p: string): string {
  const ext = extOfPath(p);
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

export interface PreloadProgress {
  completed: number;
  total: number;
}

export class PreloadQueue {
  private governor: CacheGovernor;
  private inflight: Set<string> = new Set();
  private warmCanvas: OffscreenCanvas | null = null;
  private warmCtx: OffscreenCanvasRenderingContext2D | null = null;
  private getEpoch: (() => number) | null = null;
  private concurrency = DEFAULT_CONCURRENCY;

  constructor(governor: CacheGovernor) {
    this.governor = governor;
    if (typeof OffscreenCanvas !== 'undefined') {
      try {
        this.warmCanvas = new OffscreenCanvas(1, 1);
        this.warmCtx = this.warmCanvas.getContext('2d');
      } catch {
        this.warmCanvas = null;
      }
    }
  }

  setEpochSupplier(getEpoch: () => number): void {
    this.getEpoch = getEpoch;
  }

  /**
   * Schedule decode of every static bitmap path. Skips animated/native paths
   * (GIF and WebP), cached entries, and inflight entries. Honours the
   * navigation epoch for staleness checks. Optionally calls `onProgress` after
   * every completion.
   */
  scheduleAll(paths: string[], epoch?: number, onProgress?: (p: PreloadProgress) => void): void {
    if (paths.length === 0) return;
    const myEpoch = epoch ?? (this.getEpoch ? this.getEpoch() : 0);
    const targets: string[] = [];
    for (const p of paths) {
      if (!p) continue;
      if (!isPreloadableBitmapPath(p)) continue;
      if (this.governor.has(p)) continue;
      if (this.inflight.has(p)) continue;
      targets.push(p);
    }
    if (targets.length === 0) {
      onProgress?.({ completed: 0, total: 0 });
      return;
    }

    let completed = 0;
    let cursor = 0;
    const total = targets.length;

    const launchNext = (): void => {
      // Epoch check: if navigation moved on (e.g., new album loaded),
      // stop launching more decodes from this batch.
      if (this.getEpoch && this.getEpoch() !== myEpoch) return;
      while (this.inflight.size < this.concurrency && cursor < targets.length) {
        const p = targets[cursor++]!;
        this.fetchAndDecode(p, myEpoch)
          .catch((err) => console.warn('[preload] failed:', p, err?.message ?? err))
          .finally(() => {
            completed += 1;
            onProgress?.({ completed, total });
            if (cursor < targets.length) launchNext();
          });
      }
    };
    launchNext();
  }

  /**
   * Force a single fetch+decode+warm. Returns the bitmap, or null if it
   * couldn't be admitted (stale, in-flight collision, or read error).
   */
  async fetchAndDecode(filePath: string, epoch?: number): Promise<ImageBitmap | null> {
    if (this.governor.has(filePath)) {
      const e = this.governor.get(filePath);
      return (e?.bitmap as ImageBitmap) ?? null;
    }
    if (this.inflight.has(filePath)) return null;
    this.inflight.add(filePath);
    const myEpoch = epoch ?? (this.getEpoch ? this.getEpoch() : undefined);
    try {
      const bytes = await window.api.readFile(filePath);
      const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
      const blob = new Blob([ab], { type: mimeFor(filePath) });
      const bitmap = await createImageBitmap(blob);
      if (myEpoch !== undefined && this.getEpoch && this.getEpoch() !== myEpoch) {
        try {
          (bitmap as unknown as { close?: () => void }).close?.();
        } catch {
          /* ignore */
        }
        return null;
      }
      this.governor.admit(
        filePath,
        bitmap as unknown as { width: number; height: number; close?: () => void },
      );
      if (this.warmCtx) {
        this.warmCtx.clearRect(0, 0, 1, 1);
        this.warmCtx.drawImage(bitmap, 0, 0, 1, 1);
      }
      this.governor.markWarm(filePath);
      return bitmap;
    } finally {
      this.inflight.delete(filePath);
    }
  }
}
