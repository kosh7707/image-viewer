import type { AlbumEntryDTO } from '../preload/api';
import { MAX_NATIVE_GIF_BYTES } from './animation-policy';
import { mediaKindForEntry } from './media-kind';

export type PreloadBudgetKind = 'static' | 'animated';

const UNKNOWN_ANIMATION_ENCODED_TO_DECODED_MULTIPLIER = 64;
const MIN_UNKNOWN_ANIMATION_BUDGET_BYTES = 64 * 1024 * 1024;

export interface PreloadBudgetCandidate {
  path: string;
  index: number;
  kind: PreloadBudgetKind;
  /** Null means the decoded size is unknown until renderer-side preload. */
  bytes: number | null;
}

export interface PreloadBudgetPlan {
  allowedPaths: Set<string>;
  staticBytes: number;
  animatedBytes: number;
}

export function planAlbumPreloadBudget({
  entries,
  currentIndex,
  totalLimit,
}: {
  entries: AlbumEntryDTO[];
  currentIndex: number;
  totalLimit: number;
}): PreloadBudgetPlan {
  const candidates = entries
    .map((entry, index) => ({
      path: entry.path,
      index,
      kind: preloadBudgetKindForEntry(entry),
      bytes: estimatePreloadEntryBytes(entry, totalLimit),
    }))
    .filter(
      (
        item,
      ): item is {
        path: string;
        index: number;
        kind: PreloadBudgetKind;
        bytes: number | null;
      } => item.kind !== null && (item.bytes === null || isFinitePositive(item.bytes)),
    );

  return planPreloadBudgetCandidates({
    candidates,
    currentIndex,
    totalEntries: entries.length,
    totalLimit,
  });
}

export function preloadBudgetKindForEntry(entry: AlbumEntryDTO): PreloadBudgetKind | null {
  const kind = mediaKindForEntry(entry);
  if (kind === 'static-bitmap') return 'static';
  if (kind === 'animated-gif' || kind === 'webp') return 'animated';
  return null;
}

export function estimatePreloadEntryBytes(entry: AlbumEntryDTO, limitBytes: number): number | null {
  if (preloadBudgetKindForEntry(entry) === 'static') {
    if (isFinitePositive(entry.estimatedBytes)) return Math.ceil(entry.estimatedBytes);
    if (entry.width && entry.height) return entry.width * entry.height * 4;
    /*
     * Encoded file size is not a decoded ImageBitmap size. A 10 MB JPEG/PNG
     * can admit tens or hundreds of MB after decode, so treating encodedBytes
     * as the cache limit makes scheduled preload decode and then immediately
     * evict itself. Keep stat-only static images unknown; the planner will
     * reserve the remaining RAM cap for the static cache and CacheGovernor will
     * enforce the actual decoded bytes after createImageBitmap.
     */
    return null;
  }
  return estimatePreparedMediaBytesForLimit(entry, limitBytes);
}

export function planPreloadBudgetCandidates({
  candidates,
  currentIndex,
  totalEntries,
  totalLimit,
}: {
  candidates: PreloadBudgetCandidate[];
  currentIndex: number;
  totalEntries: number;
  totalLimit: number;
}): PreloadBudgetPlan {
  const plan: PreloadBudgetPlan = {
    allowedPaths: new Set<string>(),
    staticBytes: 0,
    animatedBytes: 0,
  };

  let plannedBytes = 0;
  let hasUnknownStatic = false;
  const unknownStaticBytes = unknownStaticPlanningBytes(totalLimit);
  for (const candidate of candidates
    .filter((candidate) => {
      return candidate.bytes === null || (Number.isFinite(candidate.bytes) && candidate.bytes > 0);
    })
    .sort(
      (a, b) =>
        wrapDistance(a.index, currentIndex, totalEntries) -
          wrapDistance(b.index, currentIndex, totalEntries) || a.index - b.index,
    )) {
    const planningBytes =
      candidate.bytes ?? (candidate.kind === 'static' ? unknownStaticBytes : totalLimit);
    if (planningBytes > totalLimit) continue;
    if (plannedBytes + planningBytes > totalLimit) continue;
    plannedBytes += planningBytes;
    plan.allowedPaths.add(candidate.path);
    if (candidate.kind === 'static') {
      if (candidate.bytes === null) {
        hasUnknownStatic = true;
      } else {
        plan.staticBytes += candidate.bytes;
      }
    } else {
      plan.animatedBytes += planningBytes;
    }
  }

  if (hasUnknownStatic) {
    plan.staticBytes = Math.max(plan.staticBytes, totalLimit - plan.animatedBytes);
  }

  return plan;
}

export function wrapDistance(index: number, currentIndex: number, total: number): number {
  if (total <= 0) return 0;
  const delta = Math.abs(index - currentIndex);
  return Math.min(delta, total - delta);
}

export function shouldPrepareNativeWithin(entry: AlbumEntryDTO, limitBytes: number): boolean {
  const allFrames = entry.allFramesDecodedBytes;
  if (typeof allFrames === 'number' && allFrames > limitBytes) return true;
  const encoded = entry.encodedBytes;
  return typeof encoded === 'number' && encoded > MAX_NATIVE_GIF_BYTES;
}

export function estimateAnimationBytes(entry: AlbumEntryDTO, frameCount: number): number {
  if (typeof entry.allFramesDecodedBytes === 'number' && entry.allFramesDecodedBytes > 0) {
    return entry.allFramesDecodedBytes;
  }
  if (entry.width && entry.height) return entry.width * entry.height * 4 * frameCount;
  return Math.max(1, entry.encodedBytes ?? 1);
}

export function estimatePreparedMediaBytesForLimit(
  entry: AlbumEntryDTO,
  limitBytes: number,
): number | null {
  if (shouldPrepareNativeWithin(entry, limitBytes)) return Math.max(1, entry.encodedBytes ?? 1);
  if (isFinitePositive(entry.allFramesDecodedBytes)) return entry.allFramesDecodedBytes;
  if (entry.width && entry.height && entry.frameCount) {
    return estimateAnimationBytes(entry, entry.frameCount);
  }
  if (isFinitePositive(entry.encodedBytes)) {
    return estimateUnknownAnimationBudgetBytes(entry.encodedBytes, limitBytes);
  }
  /*
   * Encoded GIF/WebP size is only the compressed file size, not the decoded
   * frame cache size. If even that stat is unavailable, reserve one full-cache
   * slot so the nearest unknown animation can still be prepared and cached.
   */
  return limitBytes;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function estimateUnknownAnimationBudgetBytes(encodedBytes: number, limitBytes: number): number {
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) return 1;
  const inflated = Math.max(
    encodedBytes * UNKNOWN_ANIMATION_ENCODED_TO_DECODED_MULTIPLIER,
    MIN_UNKNOWN_ANIMATION_BUDGET_BYTES,
  );
  return Math.max(1, Math.min(Math.ceil(inflated), Math.floor(limitBytes)));
}

function unknownStaticPlanningBytes(totalLimit: number): number {
  if (!Number.isFinite(totalLimit) || totalLimit <= 0) return 1;
  return Math.max(1, Math.ceil(totalLimit / 64));
}
