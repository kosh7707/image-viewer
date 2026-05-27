import type { ParsedAnimation } from './gif-host';

export interface PreparedAnimationMedia {
  kind: 'animation';
  path: string;
  bytes: number;
  frames: ImageBitmap[];
  delays: number[];
  dispose?: () => void;
}

export interface PreparedNativeMedia {
  kind: 'native';
  path: string;
  bytes: number;
  url: string;
  dispose?: () => void;
}

export type PreparedMedia = PreparedAnimationMedia | PreparedNativeMedia;

interface CacheEntry {
  media: PreparedMedia;
  lastUsed: number;
  insertedAt: number;
}

export interface EnforceLimitOptions {
  protectCurrent?: boolean;
}

export class PreparedMediaCache {
  private entries = new Map<string, CacheEntry>();
  private order = new Map<string, number>();
  private orderLength = 0;
  private currentIndex = 0;
  private clock = 0;
  private maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  limitBytes(): number {
    return this.maxBytes;
  }

  setLimit(maxBytes: number, options: EnforceLimitOptions = {}): void {
    this.maxBytes = Math.max(0, Math.floor(maxBytes));
    this.enforceLimit(this.protectedPaths(options));
  }

  setOrder(paths: string[], options: EnforceLimitOptions = {}): void {
    this.order.clear();
    this.orderLength = paths.length;
    paths.forEach((path, index) => this.order.set(path, index));
    this.enforceLimit(this.protectedPaths(options));
  }

  setCurrentIndex(index: number, options: EnforceLimitOptions = {}): void {
    this.currentIndex = Math.max(0, Math.floor(index));
    this.enforceLimit(this.protectedPaths(options));
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  get(path: string): PreparedMedia | null {
    const entry = this.entries.get(path);
    if (!entry) return null;
    entry.lastUsed = ++this.clock;
    return entry.media;
  }

  put(media: PreparedMedia, options: EnforceLimitOptions = {}): boolean {
    this.delete(media.path);
    this.entries.set(media.path, {
      media,
      lastUsed: ++this.clock,
      insertedAt: this.clock,
    });
    this.enforceLimit(this.protectedPaths(options));
    if (this.entries.has(media.path)) return true;
    return false;
  }

  delete(path: string): void {
    const entry = this.entries.get(path);
    if (!entry) return;
    this.entries.delete(path);
    disposePreparedMedia(entry.media);
  }

  clear(): void {
    for (const path of [...this.entries.keys()]) this.delete(path);
  }

  totalBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.media.bytes;
    return total;
  }

  toPlayable(path: string): ParsedAnimation | null {
    const media = this.get(path);
    if (!media || media.kind !== 'animation') return null;
    return {
      frames: media.frames,
      delays: media.delays,
    };
  }

  enforceLimit(protectedPaths = new Set<string>()): void {
    while (this.totalBytes() > this.maxBytes) {
      const victim = this.pickVictim(protectedPaths);
      if (!victim) return;
      this.delete(victim);
    }
  }

  private pickVictim(protectedPaths: Set<string>): string | null {
    let best: { path: string; entry: CacheEntry; distance: number } | null = null;
    for (const [path, entry] of this.entries) {
      if (protectedPaths.has(path)) continue;
      const distance = this.distanceFromCurrent(path);
      if (
        !best ||
        distance > best.distance ||
        (distance === best.distance && entry.lastUsed < best.entry.lastUsed) ||
        (distance === best.distance &&
          entry.lastUsed === best.entry.lastUsed &&
          entry.media.bytes > best.entry.media.bytes) ||
        (distance === best.distance &&
          entry.lastUsed === best.entry.lastUsed &&
          entry.media.bytes === best.entry.media.bytes &&
          entry.insertedAt < best.entry.insertedAt)
      ) {
        best = { path, entry, distance };
      }
    }
    return best?.path ?? null;
  }

  private distanceFromCurrent(path: string): number {
    const index = this.order.get(path);
    if (index === undefined || this.orderLength <= 0) return Number.MAX_SAFE_INTEGER;
    const delta = Math.abs(index - this.currentIndex);
    return Math.min(delta, this.orderLength - delta);
  }

  currentPath(): string | null {
    for (const [path, index] of this.order) {
      if (index === this.currentIndex) return path;
    }
    return null;
  }

  private protectedPaths(options: EnforceLimitOptions): Set<string> {
    if (!options.protectCurrent) return new Set();
    return new Set([this.currentPath()].filter((p): p is string => Boolean(p)));
  }
}

export function disposePreparedMedia(media: PreparedMedia): void {
  try {
    media.dispose?.();
  } catch {
    // Ignore disposal failures; the cache is already evicting.
  }
}
