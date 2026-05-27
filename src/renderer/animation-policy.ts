import type { AlbumEntryDTO } from '../preload/api';
import { DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES } from '../shared/user-preferences';

export const MAX_NATIVE_GIF_BYTES = 100 * 1024 * 1024;
export const MAX_ANIMATION_DECODE_BYTES = DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES;

function finitePositive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function exceedsAllFrameDecodeCap(entry: AlbumEntryDTO): boolean {
  const allFramesBytes = finitePositive(entry.allFramesDecodedBytes);
  return allFramesBytes !== null && allFramesBytes > MAX_ANIMATION_DECODE_BYTES;
}

export function shouldUseNativeAnimatedWebp(entry: AlbumEntryDTO): boolean {
  return exceedsAllFrameDecodeCap(entry);
}

export function shouldUseNativeGif(entry: AlbumEntryDTO): boolean {
  const encodedBytes = finitePositive(entry.encodedBytes);
  return (
    (encodedBytes !== null && encodedBytes > MAX_NATIVE_GIF_BYTES) ||
    exceedsAllFrameDecodeCap(entry)
  );
}
