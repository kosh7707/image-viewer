/**
 * preload-queue.ts — fetch+decode static images selected by the RAM planner.
 *
 * Cache policy v3: no fixed sliding window. The caller supplies the paths that
 * fit the user's preload RAM limit, sorted around the current album index.
 * GIFs and animated/unknown WebP files are skipped here; they go through
 * dedicated animated/native playback paths.
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

export interface PreloadScheduleOptions {
  protectCurrent?: boolean;
  currentIndex?: number;
  allowedPaths?: Set<string>;
}

interface DecodeOptions {
  protectAdmitted?: boolean;
  respectActivePlan?: boolean;
  scheduleId?: number;
}

type PreloadSource = string | AlbumEntryDTO;

export class PreloadQueue {
  private governor: CacheGovernor;
  private inflight: Map<
    string,
    { epoch: number | undefined; options: DecodeOptions; promise: Promise<ImageBitmap | null> }
  > = new Map();
  private warmCanvas: OffscreenCanvas | null = null;
  private warmCtx: OffscreenCanvasRenderingContext2D | null = null;
  private getEpoch: (() => number) | null = null;
  private concurrency = DEFAULT_CONCURRENCY;
  private scheduleGeneration = 0;
  private activeAllowedPaths: Set<string> | null = null;

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

  cancelScheduled(): void {
    this.scheduleGeneration += 1;
    this.activeAllowedPaths = null;
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
    options: PreloadScheduleOptions = {},
  ): void {
    if (sources.length === 0) return;
    const scheduleId = ++this.scheduleGeneration;
    this.activeAllowedPaths = options.allowedPaths ? new Set(options.allowedPaths) : null;
    if (options.allowedPaths) this.governor.retainOnly(options.allowedPaths, options);
    const myEpoch = epoch ?? (this.getEpoch ? this.getEpoch() : 0);
    const currentPath = currentPathOf(sources, options.currentIndex);
    const candidates: Array<{ path: string; index: number; estimatedBytes: number | null }> = [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index]!;
      const p = pathOf(source);
      if (!p) continue;
      if (options.allowedPaths && !options.allowedPaths.has(p)) continue;
      if (!isPreloadableSource(source)) continue;
      if (this.governor.has(p)) continue;
      if (this.inflight.has(p)) continue;
      candidates.push({
        path: p,
        index,
        estimatedBytes: estimatePreloadBytes(source),
      });
    }
    const currentIndex = normalizeCurrentIndex(options.currentIndex, sources.length);
    candidates.sort(
      (a, b) =>
        circularDistance(a.index, currentIndex, sources.length) -
          circularDistance(b.index, currentIndex, sources.length) || a.index - b.index,
    );

    const targets = this.planTargets(candidates);
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
      if (this.scheduleGeneration !== scheduleId) return;
      while (this.inflight.size < this.concurrency && cursor < targets.length) {
        const p = targets[cursor++]!;
        this.fetchAndDecode(p, myEpoch, {
          protectAdmitted: Boolean(options.protectCurrent && p === currentPath),
          respectActivePlan: true,
          scheduleId,
        })
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
  async fetchAndDecode(
    filePath: string,
    epoch?: number,
    options: DecodeOptions = {},
  ): Promise<ImageBitmap | null> {
    if (this.governor.has(filePath)) {
      const e = this.governor.get(filePath);
      return (e?.bitmap as ImageBitmap) ?? null;
    }
    const myEpoch = epoch ?? (this.getEpoch ? this.getEpoch() : undefined);
    while (true) {
      const existing = this.inflight.get(filePath);
      if (!existing) break;
      if (options.protectAdmitted) {
        existing.options.protectAdmitted = true;
        existing.options.respectActivePlan = false;
        delete existing.options.scheduleId;
      }
      if (existing.epoch === myEpoch) return await existing.promise;
      await existing.promise.catch(() => null);
      if (this.governor.has(filePath)) {
        const e = this.governor.get(filePath);
        return (e?.bitmap as ImageBitmap) ?? null;
      }
    }

    const decodeOptions = { ...options };
    const promise = this.decodeAndAdmit(filePath, myEpoch, decodeOptions);
    this.inflight.set(filePath, { epoch: myEpoch, options: decodeOptions, promise });
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
    options: DecodeOptions = {},
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
    if (options.scheduleId !== undefined && options.scheduleId !== this.scheduleGeneration) {
      try {
        (bitmap as unknown as { close?: () => void }).close?.();
      } catch {
        /* ignore */
      }
      return null;
    }
    if (options.respectActivePlan && !this.isActivePlanAllowed(filePath)) {
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
      undefined,
      options.protectAdmitted ? { protectPath: filePath } : undefined,
    );
    if (!this.governor.has(filePath)) return null;
    if (this.warmCtx) {
      this.warmCtx.clearRect(0, 0, 1, 1);
      this.warmCtx.drawImage(bitmap, 0, 0, 1, 1);
    }
    this.governor.markWarm(filePath);
    return bitmap;
  }

  private isActivePlanAllowed(filePath: string): boolean {
    return !this.activeAllowedPaths || this.activeAllowedPaths.has(filePath);
  }

  private planTargets(
    candidates: Array<{ path: string; estimatedBytes: number | null }>,
  ): string[] {
    const targets: string[] = [];
    let plannedBytes = this.governor.bytes();
    const limitBytes = this.governor.limitBytes();
    for (const candidate of candidates) {
      const bytes = candidate.estimatedBytes;
      if (bytes !== null) {
        if (bytes > limitBytes) continue;
        if (plannedBytes + bytes > limitBytes) continue;
        plannedBytes += bytes;
      }
      targets.push(candidate.path);
    }
    return targets;
  }
}

function pathOf(source: PreloadSource): string {
  return typeof source === 'string' ? source : source.path;
}

function currentPathOf(sources: PreloadSource[], index: number | undefined): string | null {
  const currentIndex = normalizeCurrentIndex(index, sources.length);
  const source = sources[currentIndex];
  return source ? pathOf(source) : null;
}

function isPreloadableSource(source: PreloadSource): boolean {
  return typeof source === 'string'
    ? isPreloadableBitmapPath(source)
    : isPreloadableBitmapEntry(source);
}

function estimatePreloadBytes(source: PreloadSource): number | null {
  if (typeof source === 'string') return null;
  const value = source.estimatedBytes;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

function normalizeCurrentIndex(index: number | undefined, length: number): number {
  if (length <= 0 || typeof index !== 'number' || !Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(length - 1, Math.floor(index)));
}

function circularDistance(index: number, currentIndex: number, length: number): number {
  if (length <= 0) return 0;
  const delta = Math.abs(index - currentIndex);
  return Math.min(delta, length - delta);
}

async function decodeBitmap(filePath: string, bytes: Uint8Array): Promise<ImageBitmap> {
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const blob = new Blob([ab], { type: mimeFor(filePath) });
  return await createImageBitmap(blob);
}
