/**
 * preload-queue.ts — fetch+decode every static image in the album.
 *
 * Cache policy v2: no sliding window. The album-loader gates total RAM via
 * the 4 GB confirm dialog, so the queue simply enqueues every path the
 * caller hands it, skipping entries already cached or in flight. GIFs and
 * animated/unknown WebP files are skipped here; they go through dedicated
 * animated/native playback paths.
 *
 * Each decoded entry is admitted to the CacheGovernor, then GPU-pre-warmed
 * via a 1x1 drawImage to a hidden OffscreenCanvas so subsequent navigations
 * paint without a texture-upload stall.
 *
 * Optionally a concurrency limit keeps disk IO from being saturated by
 * thousands of simultaneous reads; default 8 fetches in flight.
 */

import { CacheGovernor } from './cache-governor';
import { extOfPath, isPreloadableBitmapEntry, isPreloadableBitmapPath } from './media-kind';
import type { AlbumEntryDTO } from '../preload/api';
import { isAnimatedWebpBytes } from '../shared/webp-info';

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

type PreloadSource = string | AlbumEntryDTO;

export class PreloadQueue {
  private governor: CacheGovernor;
  private inflight: Map<
    string,
    { epoch: number | undefined; promise: Promise<ImageBitmap | null> }
  > = new Map();
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
   * Schedule decode of every measured static bitmap source. Skips animated/native paths
   * (GIF, animated WebP, and metadata-less WebP), cached entries, and inflight entries. Honours the
   * navigation epoch for staleness checks. Optionally calls `onProgress` after
   * every completion.
   */
  scheduleAll(
    sources: PreloadSource[],
    epoch?: number,
    onProgress?: (p: PreloadProgress) => void,
  ): void {
    if (sources.length === 0) return;
    const myEpoch = epoch ?? (this.getEpoch ? this.getEpoch() : 0);
    const targets: string[] = [];
    for (const source of sources) {
      const p = pathOf(source);
      if (!p) continue;
      if (!isPreloadableSource(source)) continue;
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
   * Force a single fetch+decode+warm. Returns the bitmap, joins matching
   * in-flight work, or returns null if it couldn't be admitted (stale/animated).
   */
  async fetchAndDecode(filePath: string, epoch?: number): Promise<ImageBitmap | null> {
    if (this.governor.has(filePath)) {
      const e = this.governor.get(filePath);
      return (e?.bitmap as ImageBitmap) ?? null;
    }
    const myEpoch = epoch ?? (this.getEpoch ? this.getEpoch() : undefined);
    while (true) {
      const existing = this.inflight.get(filePath);
      if (!existing) break;
      if (existing.epoch === myEpoch) return await existing.promise;
      await existing.promise.catch(() => null);
      if (this.governor.has(filePath)) {
        const e = this.governor.get(filePath);
        return (e?.bitmap as ImageBitmap) ?? null;
      }
    }

    const promise = this.decodeAndAdmit(filePath, myEpoch);
    this.inflight.set(filePath, { epoch: myEpoch, promise });
    try {
      return await promise;
    } finally {
      if (this.inflight.get(filePath)?.promise === promise) {
        this.inflight.delete(filePath);
      }
    }
  }

  private async decodeAndAdmit(
    filePath: string,
    myEpoch: number | undefined,
  ): Promise<ImageBitmap | null> {
    const bytes = await window.api.readFile(filePath);
    if (extOfPath(filePath) === '.webp' && isAnimatedWebpBytes(bytes)) return null;
    const bitmap = await decodeBitmap(filePath, bytes);
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
  }
}

function pathOf(source: PreloadSource): string {
  return typeof source === 'string' ? source : source.path;
}

function isPreloadableSource(source: PreloadSource): boolean {
  return typeof source === 'string'
    ? isPreloadableBitmapPath(source)
    : isPreloadableBitmapEntry(source);
}

async function decodeBitmap(filePath: string, bytes: Uint8Array): Promise<ImageBitmap> {
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([ab], { type: mimeFor(filePath) });
  return await createImageBitmap(blob);
}
