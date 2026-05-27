import type { AlbumEntryDTO } from '../preload/api';
import { mediaKindForEntry } from './media-kind';
import {
  disposePreparedMedia,
  PreparedMediaCache,
  type EnforceLimitOptions,
  type PreparedMedia,
} from './prepared-media-cache';

export interface AnimatedMediaPrepareContext {
  signal: AbortSignal;
  reason: 'current' | 'preload';
}

export type AnimatedMediaPreparer = (
  entry: AlbumEntryDTO,
  context: AnimatedMediaPrepareContext,
) => Promise<PreparedMedia | null>;

export type EstimatePreparedMediaBytes = (entry: AlbumEntryDTO) => number | null;

export interface AnimatedEnsureOptions extends EnforceLimitOptions {
  estimatedBytes?: number | null;
  reason?: 'current' | 'preload';
}

export interface AnimatedScheduleOptions extends EnforceLimitOptions {
  estimateBytes?: EstimatePreparedMediaBytes;
}

interface InflightPreparation {
  controller: AbortController;
  promise: Promise<PreparedMedia | null>;
}

export class AnimatedMediaPreloader {
  private cache: PreparedMediaCache;
  private prepare: AnimatedMediaPreparer;
  private inflight = new Map<string, InflightPreparation>();
  private generation = 0;
  private scheduleGeneration = 0;
  private activeProtectedPaths = new Set<string>();

  constructor(cache: PreparedMediaCache, prepare: AnimatedMediaPreparer) {
    this.cache = cache;
    this.prepare = prepare;
  }

  async ensure(
    entry: AlbumEntryDTO,
    currentIndex: number,
    options: AnimatedEnsureOptions = {},
  ): Promise<PreparedMedia | null> {
    const protectCurrent = options.protectCurrent || this.activeProtectedPaths.has(entry.path);
    this.cache.setCurrentIndex(currentIndex, {
      protectCurrent,
    });
    const cached = this.cache.get(entry.path);
    if (cached) return cached;
    if (!isAnimatedPreloadEntry(entry)) return null;
    const existing = this.inflight.get(entry.path);
    if (existing) return await existing.promise;

    const estimatedBytes = normalizeByteEstimate(options.estimatedBytes);
    if (
      estimatedBytes !== null &&
      estimatedBytes <= this.cache.limitBytes() &&
      !this.cache.makeRoomFor(estimatedBytes, { protectCurrent })
    ) {
      return null;
    }

    const generation = this.generation;
    const controller = new AbortController();
    const promise = this.prepare(entry, {
      signal: controller.signal,
      reason: options.reason ?? 'current',
    })
      .then((media) => {
        if (this.generation !== generation || controller.signal.aborted) {
          if (media) disposePreparedMedia(media);
          return null;
        }
        if (media) {
          if (media.bytes > this.cache.limitBytes()) return media;
          if (
            media.bytes <= this.cache.limitBytes() &&
            !this.cache.makeRoomFor(media.bytes, { protectCurrent })
          ) {
            disposePreparedMedia(media);
            return null;
          }
          this.cache.put(media, {
            protectCurrent: protectCurrent || this.activeProtectedPaths.has(media.path),
          });
          return this.cache.get(media.path);
        }
        return null;
      })
      .finally(() => {
        if (this.inflight.get(entry.path)?.promise === promise) {
          this.inflight.delete(entry.path);
        }
      });
    this.inflight.set(entry.path, { controller, promise });
    return await promise;
  }

  async schedule(
    entries: AlbumEntryDTO[],
    currentIndex: number,
    options: AnimatedScheduleOptions = {},
  ): Promise<void> {
    const scheduleId = ++this.scheduleGeneration;
    this.activeProtectedPaths =
      options.protectCurrent && entries[currentIndex]?.path
        ? new Set([entries[currentIndex]!.path])
        : new Set();
    this.cache.setOrder(
      entries.map((entry) => entry.path),
      options,
    );
    this.cache.setCurrentIndex(currentIndex, options);
    const ordered = entries
      .map((entry, index) => ({
        entry,
        index,
        distance: circularDistance(index, currentIndex, entries.length),
      }))
      .filter(({ entry }) => isAnimatedPreloadEntry(entry))
      .sort((a, b) => a.distance - b.distance || a.index - b.index);

    const plannedPaths = this.planSchedule(ordered, options.estimateBytes);
    this.abortInflightExcept(plannedPaths);

    try {
      for (const { entry } of ordered) {
        if (this.scheduleGeneration !== scheduleId) return;
        if (!plannedPaths.has(entry.path)) continue;
        if (!this.cache.has(entry.path)) {
          const estimatedBytes = estimateForEntry(entry, options.estimateBytes);
          if (
            estimatedBytes !== null &&
            estimatedBytes <= this.cache.limitBytes() &&
            !this.cache.makeRoomFor(estimatedBytes, {
              protectCurrent: options.protectCurrent,
            })
          ) {
            continue;
          }
          const prepared = await this.ensure(entry, currentIndex, {
            ...options,
            estimatedBytes,
            reason: 'preload',
          });
          if (this.scheduleGeneration !== scheduleId) return;
          if (prepared && options.protectCurrent)
            this.cache.enforceLimit(this.activeProtectedPaths);
        }
      }
    } finally {
      if (this.scheduleGeneration === scheduleId) {
        this.activeProtectedPaths = new Set();
      }
    }
  }

  clear(): void {
    this.generation += 1;
    this.scheduleGeneration += 1;
    this.abortInflightExcept(new Set());
    this.inflight.clear();
  }

  private planSchedule(
    ordered: Array<{ entry: AlbumEntryDTO; index: number; distance: number }>,
    estimateBytes: EstimatePreparedMediaBytes | undefined,
  ): Set<string> {
    const plannedPaths = new Set<string>();
    let plannedBytes = 0;
    const limitBytes = this.cache.limitBytes();

    for (const { entry } of ordered) {
      const bytes =
        normalizeByteEstimate(this.cache.bytesFor(entry.path)) ??
        estimateForEntry(entry, estimateBytes);
      if (bytes === null) continue;
      if (bytes > limitBytes) {
        if (this.cache.has(entry.path)) plannedPaths.add(entry.path);
        continue;
      }
      if (plannedBytes + bytes > limitBytes) break;
      plannedPaths.add(entry.path);
      plannedBytes += bytes;
    }

    return plannedPaths;
  }

  private abortInflightExcept(retainedPaths: Set<string>): void {
    for (const [path, preparation] of this.inflight) {
      if (retainedPaths.has(path)) continue;
      preparation.controller.abort();
    }
  }
}

export function isAnimatedPreloadEntry(entry: AlbumEntryDTO): boolean {
  const kind = mediaKindForEntry(entry);
  return kind === 'animated-gif' || (kind === 'webp' && entry.frameCount !== 1);
}

export function circularDistance(index: number, currentIndex: number, length: number): number {
  if (length <= 0) return 0;
  const delta = Math.abs(index - currentIndex);
  return Math.min(delta, length - delta);
}

function estimateForEntry(
  entry: AlbumEntryDTO,
  estimateBytes: EstimatePreparedMediaBytes | undefined,
): number | null {
  return (
    normalizeByteEstimate(estimateBytes?.(entry)) ??
    normalizeByteEstimate(entry.allFramesDecodedBytes) ??
    normalizeByteEstimate(entry.encodedBytes) ??
    1
  );
}

function normalizeByteEstimate(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}
