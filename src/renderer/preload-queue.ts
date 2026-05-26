/**
 * preload-queue.ts — fetch+decode the ±10 window around the current index.
 *
 * On `currentIndex` change we schedule decodes for `[idx-10, idx+10]`,
 * skipping entries already cached. Decoded entries are admitted to the
 * CacheGovernor, then GPU-pre-warmed via a 1x1 drawImage to a hidden
 * OffscreenCanvas.
 */

import { CacheGovernor } from './cache-governor';
import * as path from 'path';

const PRELOAD_RADIUS = 10;

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i >= 0 ? p.slice(i).toLowerCase() : '';
}

function mimeFor(p: string): string {
  const ext = extOf(p);
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

export class PreloadQueue {
  private governor: CacheGovernor;
  private inflight: Set<string> = new Set();
  private warmCanvas: OffscreenCanvas | null = null;
  private warmCtx: OffscreenCanvasRenderingContext2D | null = null;
  /**
   * Optional callback supplying the current navigation epoch. The queue
   * uses it to discard stale results from rapid arrow-key navigation.
   * Returning `undefined` (or leaving unset) disables epoch checks.
   */
  private getEpoch: (() => number) | null = null;

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

  /** Install (or replace) the epoch supplier used for staleness checks. */
  setEpochSupplier(getEpoch: () => number): void {
    this.getEpoch = getEpoch;
  }

  /**
   * Schedule preloads for paths around `currentIndex` (inclusive).
   * Out-of-bounds indices are clamped (no wrap).
   *
   * `epoch` is captured at call time; if `getEpoch()` later diverges,
   * any in-flight decode for this batch will be discarded on completion.
   */
  schedule(paths: string[], currentIndex: number, epoch?: number): void {
    if (paths.length === 0) return;
    const myEpoch = epoch ?? (this.getEpoch ? this.getEpoch() : 0);
    const start = Math.max(0, currentIndex - PRELOAD_RADIUS);
    const end = Math.min(paths.length - 1, currentIndex + PRELOAD_RADIUS);
    for (let i = start; i <= end; i++) {
      const p = paths[i];
      if (!p) continue;
      if (this.governor.has(p)) continue;
      if (this.inflight.has(p)) continue;
      // Skip GIFs in the standard preload path — they go through gif-host.
      if (extOf(p) === '.gif') continue;
      this.fetchAndDecode(p, myEpoch).catch((err) => {
        // log + skip; do not poison the cache.
        // eslint-disable-next-line no-console
        console.warn('[preload] failed:', p, err?.message ?? err);
      });
    }
  }

  /**
   * Force a single fetch+decode+warm; resolves with the ImageBitmap.
   *
   * If `epoch` is provided and no longer matches `getEpoch()` after the
   * decode completes, the bitmap is closed and NOT admitted to the cache.
   * The resolved value will be `null` in that case so callers know to bail.
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
      // Slice to a clean ArrayBuffer (not SharedArrayBuffer) for Blob.
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([ab], { type: mimeFor(filePath) });
      const bitmap = await createImageBitmap(blob);
      // Epoch check: if navigation moved on since we started, discard.
      if (myEpoch !== undefined && this.getEpoch && this.getEpoch() !== myEpoch) {
        try {
          (bitmap as unknown as { close?: () => void }).close?.();
        } catch {
          // best-effort; ignore
        }
        return null;
      }
      this.governor.admit(filePath, bitmap as unknown as { width: number; height: number; close?: () => void });
      // GPU pre-warm: draw once to a 1x1 scratch surface.
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

// Re-export for callers
export { PRELOAD_RADIUS };
// Suppress unused import for `path` if tsc strict
void path;
