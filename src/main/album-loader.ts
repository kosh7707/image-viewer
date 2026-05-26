import type { WalkEntry } from './walk';
import type { ImageEstimate } from './measure';

export const DEFAULT_SOFT_CAP_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB

export type ProgressPhase = 'measuring';

export interface AlbumLoadDeps {
  walk: (rootDir: string) => WalkEntry[];
  measureFile: (filePath: string) => Promise<ImageEstimate>;
  /** Return true to proceed, false to cancel. Only called when total > softCap. */
  confirmOverCap: (totalBytes: number, fileCount: number) => Promise<boolean>;
  onProgress?: (phase: ProgressPhase, completed: number, total: number, bytesSoFar: number) => void;
  softCapBytes?: number;
}

export interface AlbumLoadResult {
  status: 'ok' | 'cancelled' | 'empty';
  entries: MeasuredWalkEntry[];
  totalBytes: number;
}

export interface MeasuredWalkEntry extends WalkEntry {
  estimate: ImageEstimate;
}

/**
 * IDENTIFYING -> MEASURING -> (CONFIRMING if over cap) -> ready.
 *
 * Per-file measure failures are silently dropped from the album so a single
 * bad image cannot block opening a folder of 1000.
 */
export async function loadAlbum(rootDir: string, deps: AlbumLoadDeps): Promise<AlbumLoadResult> {
  const softCap = deps.softCapBytes ?? DEFAULT_SOFT_CAP_BYTES;

  // IDENTIFYING
  const walked = deps.walk(rootDir);
  if (walked.length === 0) {
    return { status: 'empty', entries: [], totalBytes: 0 };
  }

  // MEASURING (sequential; per-file readFile is the dominant cost anyway)
  const surviving: MeasuredWalkEntry[] = [];
  let totalBytes = 0;
  for (let i = 0; i < walked.length; i++) {
    const entry = walked[i]!;
    try {
      const est = await deps.measureFile(entry.path);
      surviving.push({ ...entry, estimate: est });
      totalBytes += est.bytes;
    } catch {
      // silently drop unreadable / corrupt file
    }
    deps.onProgress?.('measuring', i + 1, walked.length, totalBytes);
  }

  if (surviving.length === 0) {
    return { status: 'empty', entries: [], totalBytes: 0 };
  }

  // CONFIRMING (only above soft cap)
  if (totalBytes > softCap) {
    const ok = await deps.confirmOverCap(totalBytes, surviving.length);
    if (!ok) {
      return { status: 'cancelled', entries: [], totalBytes };
    }
  }

  return { status: 'ok', entries: surviving, totalBytes };
}
