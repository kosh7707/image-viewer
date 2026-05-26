/**
 * Classify image paths by the renderer pipeline that can faithfully display
 * them in Chromium.
 *
 * Important distinction: `createImageBitmap(new Blob([animatedWebp]))` yields a
 * single bitmap, not an animation. WebP must therefore stay out of the static
 * preload/cache path and enter the WebP-specific renderer, which can use
 * WebCodecs for animated files and fall back to native `<img>` playback.
 */

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
