/**
 * CacheGovernor — bounded cache over decoded static image entries.
 *
 * Invariant (AC-P4): `count <= MAX_ENTRIES AND projectedBytes <= MAX_BYTES`.
 * Whichever bound binds first evicts entries farthest from the current sorted
 * index; LRU is only the tie-breaker.
 *
 * GPU pre-warm is intentionally NOT in this class — it depends on
 * OffscreenCanvas/createImageBitmap which aren't available in a pure
 * Node test environment. Inject a `warmer` callback via the constructor
 * or call the standalone `warmEntry(governor, path, warmFn)` helper.
 *
 * Bitmap-like type uses structural typing so unit tests can pass plain
 * `{ width, height, close }` objects without requiring a real DOM.
 */

export interface BitmapLike {
  width: number;
  height: number;
  /** Release backing resources. Optional for test fakes. */
  close?: () => void;
}

export interface CacheEntry {
  bitmap: BitmapLike;
  /** projected byte cost: w*h*4 + (gifFrameBytes ?? 0) */
  bytes: number;
  /** GPU upload completed for this entry. */
  warm: boolean;
  /** Insertion order tracker — incremented by governor. Used for telemetry. */
  insertedAt: number;
}

export interface CacheGovernorOptions {
  maxEntries?: number;
  maxBytes?: number;
  /** Called when an entry is evicted; useful for telemetry/tests. */
  onEvict?: (path: string, entry: CacheEntry) => void;
}

export const DEFAULT_MAX_ENTRIES = 20;
export const DEFAULT_MAX_BYTES = 3_000_000_000; // 3 GB

export class CacheGovernor {
  // Map preserves insertion order; we mimic LRU by re-inserting on get/has.
  private entries: Map<string, CacheEntry> = new Map();
  private order = new Map<string, number>();
  private orderLength = 0;
  private currentIndex = 0;
  private totalBytes = 0;
  private counter = 0;

  private maxEntries: number;
  private maxBytes: number;
  private readonly onEvict?: (path: string, entry: CacheEntry) => void;

  constructor(opts: CacheGovernorOptions = {}) {
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    this.onEvict = opts.onEvict;
  }

  limitBytes(): number {
    return this.maxBytes;
  }

  setLimit(maxBytes: number): void {
    this.maxBytes = Math.max(0, Math.floor(maxBytes));
    this.evictIfNeeded();
  }

  setOrder(paths: string[]): void {
    this.order.clear();
    this.orderLength = paths.length;
    paths.forEach((path, index) => this.order.set(path, index));
    this.evictIfNeeded();
  }

  setCurrentIndex(index: number): void {
    this.currentIndex = Math.max(0, Math.floor(index));
    this.evictIfNeeded();
  }

  retainOnly(paths: ReadonlySet<string>): void {
    for (const path of Array.from(this.entries.keys())) {
      if (!paths.has(path)) this.evict(path);
    }
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  get(path: string): CacheEntry | undefined {
    const entry = this.entries.get(path);
    if (entry !== undefined) {
      // Touch: move to most-recently-used end.
      this.entries.delete(path);
      entry.insertedAt = ++this.counter;
      this.entries.set(path, entry);
    }
    return entry;
  }

  /**
   * Admit a new bitmap to the cache.
   * `bytes = bitmap.width * bitmap.height * 4 + (gifFrameBytes ?? 0)`.
   * After admit, eviction runs until both bounds pass.
   */
  admit(path: string, bitmap: BitmapLike, gifFrameBytes?: number): CacheEntry {
    if (this.entries.has(path)) {
      // Replace existing entry; subtract old bytes.
      const old = this.entries.get(path)!;
      this.totalBytes -= old.bytes;
      this.entries.delete(path);
      if (old.bitmap.close && old.bitmap !== bitmap) {
        try {
          old.bitmap.close();
        } catch {
          /* ignore */
        }
      }
    }
    const bytes = bitmap.width * bitmap.height * 4 + (gifFrameBytes ?? 0);
    const entry: CacheEntry = {
      bitmap,
      bytes,
      warm: false,
      insertedAt: ++this.counter,
    };
    this.entries.set(path, entry);
    this.totalBytes += bytes;
    this.evictIfNeeded();
    return entry;
  }

  /**
   * Mark entry as GPU-pre-warmed (uploaded once to GPU).
   * Returns true if entry exists.
   */
  markWarm(path: string): boolean {
    const entry = this.entries.get(path);
    if (!entry) return false;
    entry.warm = true;
    return true;
  }

  /**
   * Evict entries until invariants hold:
   *   size <= maxEntries AND totalBytes <= maxBytes.
   */
  evictIfNeeded(): void {
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const victim = this.pickVictim();
      if (!victim) break;
      this.evict(victim);
    }
  }

  /** Explicitly drop a single entry. */
  evict(path: string): boolean {
    const entry = this.entries.get(path);
    if (!entry) return false;
    this.entries.delete(path);
    this.totalBytes -= entry.bytes;
    if (entry.bitmap.close) {
      try {
        entry.bitmap.close();
      } catch {
        /* ignore */
      }
    }
    if (this.onEvict) {
      try {
        this.onEvict(path, entry);
      } catch {
        /* ignore */
      }
    }
    return true;
  }

  /** Drop everything (used by cold-path benchmark). */
  evictAll(): void {
    for (const path of Array.from(this.entries.keys())) {
      this.evict(path);
    }
  }

  size(): number {
    return this.entries.size;
  }

  bytes(): number {
    return this.totalBytes;
  }

  /** Snapshot of paths in LRU order (oldest first). */
  keys(): string[] {
    return Array.from(this.entries.keys());
  }

  private pickVictim(): string | null {
    let best: { path: string; distance: number; entry: CacheEntry } | null = null;
    for (const [path, entry] of this.entries) {
      const distance = this.distanceFromCurrent(path);
      if (
        !best ||
        distance > best.distance ||
        (distance === best.distance && entry.insertedAt < best.entry.insertedAt)
      ) {
        best = { path, distance, entry };
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
}

/**
 * GPU pre-warm helper kept OUTSIDE the governor so the governor stays
 * test-friendly in a pure-Node context. Pass the real warmer (an
 * OffscreenCanvas drawImage call) from the renderer.
 */
export async function warmEntry(
  governor: CacheGovernor,
  path: string,
  warmer: (bitmap: BitmapLike) => Promise<void> | void,
): Promise<void> {
  const entry = governor.get(path);
  if (!entry || entry.warm) return;
  await warmer(entry.bitmap);
  governor.markWarm(path);
}
