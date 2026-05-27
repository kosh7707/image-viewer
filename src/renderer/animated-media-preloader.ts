import type { AlbumEntryDTO } from '../preload/api';
import { mediaKindForEntry } from './media-kind';
import {
  disposePreparedMedia,
  PreparedMediaCache,
  type EnforceLimitOptions,
  type PreparedMedia,
} from './prepared-media-cache';

export type AnimatedMediaPreparer = (entry: AlbumEntryDTO) => Promise<PreparedMedia | null>;

export class AnimatedMediaPreloader {
  private cache: PreparedMediaCache;
  private prepare: AnimatedMediaPreparer;
  private inflight = new Map<string, Promise<PreparedMedia | null>>();
  private generation = 0;
  private activeProtectedPaths = new Set<string>();

  constructor(cache: PreparedMediaCache, prepare: AnimatedMediaPreparer) {
    this.cache = cache;
    this.prepare = prepare;
  }

  async ensure(
    entry: AlbumEntryDTO,
    currentIndex: number,
    options: EnforceLimitOptions = {},
  ): Promise<PreparedMedia | null> {
    this.cache.setCurrentIndex(currentIndex, {
      protectCurrent: options.protectCurrent || this.activeProtectedPaths.has(entry.path),
    });
    const cached = this.cache.get(entry.path);
    if (cached) return cached;
    if (!isAnimatedPreloadEntry(entry)) return null;
    const existing = this.inflight.get(entry.path);
    if (existing) return await existing;

    const generation = this.generation;
    const promise = this.prepare(entry)
      .then((media) => {
        if (this.generation !== generation) {
          if (media) disposePreparedMedia(media);
          return null;
        }
        if (media) {
          this.cache.put(media, {
            protectCurrent: options.protectCurrent || this.activeProtectedPaths.has(media.path),
          });
          return this.cache.get(media.path);
        }
        return null;
      })
      .finally(() => {
        this.inflight.delete(entry.path);
      });
    this.inflight.set(entry.path, promise);
    return await promise;
  }

  async schedule(
    entries: AlbumEntryDTO[],
    currentIndex: number,
    options: EnforceLimitOptions = {},
  ): Promise<void> {
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

    try {
      for (const { entry } of ordered) {
        if (!this.cache.has(entry.path)) {
          const prepared = await this.ensure(entry, currentIndex, options);
          if (prepared && options.protectCurrent)
            this.cache.enforceLimit(this.activeProtectedPaths);
        }
      }
    } finally {
      this.activeProtectedPaths = new Set();
    }
  }

  clear(): void {
    this.generation += 1;
    this.inflight.clear();
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
