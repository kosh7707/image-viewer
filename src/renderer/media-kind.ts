/**
 * Classify image paths by the renderer pipeline that can faithfully display
 * them in Chromium.
 *
 * Important distinction: `createImageBitmap(new Blob([animatedWebp]))` yields a
 * single bitmap, not an animation. Static WebP may use the bitmap cache only
 * when album-load metadata proves it has one frame; animated or metadata-less
 * WebP stays on the WebP-specific renderer. EPS is rasterized by the main
 * process first, then cached as a static bitmap under the original EPS path.
 */

import type { AlbumEntryDTO } from '../preload/api';

export type MediaKind = 'animated-gif' | 'webp' | 'static-bitmap';

export function extOfPath(filePath: string): string {
  const i = filePath.lastIndexOf('.');
  return i >= 0 ? filePath.slice(i).toLowerCase() : '';
}

export function mediaKindForPath(filePath: string): MediaKind {
  const ext = extOfPath(filePath);
  if (ext === '.gif') return 'animated-gif';
  if (ext === '.webp') return 'webp';
  return 'static-bitmap';
}

export function isPreloadableBitmapPath(filePath: string): boolean {
  return mediaKindForPath(filePath) === 'static-bitmap';
}

export function mediaKindForEntry(entry: AlbumEntryDTO): MediaKind {
  const kind = mediaKindForPath(entry.path);
  if (kind !== 'webp') return kind;
  return entry.frameCount === 1 ? 'static-bitmap' : 'webp';
}

export function isPreloadableBitmapEntry(entry: AlbumEntryDTO): boolean {
  return mediaKindForEntry(entry) === 'static-bitmap';
}
