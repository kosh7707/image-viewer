import * as fs from 'node:fs';
import { imageSize } from 'image-size';
import { parseGIF } from 'gifuct-js';
import { parseAnimatedWebpInfo } from '../shared/webp-info';

export type SupportedExt = '.jpg' | '.jpeg' | '.png' | '.webp' | '.gif';

export interface ImageEstimate {
  /**
   * Legacy/full materialization estimate: RGBA bytes if every frame is decoded
   * into a full-canvas bitmap. Animated formats scale by frame count.
   */
  bytes: number;
  /** Original encoded file size in bytes. */
  encodedBytes: number;
  /**
   * Decoded bytes that the static preload cache is expected to admit.
   * Animated media is intentionally excluded from the static bitmap preload.
   */
  preloadBytes: number;
  /**
   * Current renderer playback materialization cost. This matches the all-frame
   * estimate until a native/streaming policy is selected at render time.
   */
  playbackBytes: number;
  width: number;
  height: number;
  /** Number of frames; 1 for static images. */
  frameCount: number;
}

const STATIC_EXTS: ReadonlySet<SupportedExt> = new Set(['.jpg', '.jpeg', '.png']);

interface GifLsd {
  width: number;
  height: number;
}
interface GifParsed {
  lsd: GifLsd;
  frames: unknown[];
}

function estimateFor(
  width: number,
  height: number,
  frameCount: number,
  encodedBytes: number,
  preloadable: boolean,
): ImageEstimate {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const safeFrameCount = Number.isFinite(frameCount) && frameCount > 0 ? frameCount : 0;
  const frameBytes = safeWidth * safeHeight * 4;
  const allFramesBytes = frameBytes * safeFrameCount;
  return {
    width: safeWidth,
    height: safeHeight,
    frameCount: safeFrameCount,
    bytes: allFramesBytes,
    encodedBytes,
    preloadBytes: preloadable ? allFramesBytes : 0,
    playbackBytes: allFramesBytes,
  };
}

function measureGif(buf: Buffer): ImageEstimate {
  try {
    // gifuct-js accepts ArrayBuffer-like. Copy into a clean ArrayBuffer so
    // we never hand it a SharedArrayBuffer-backed slice (Buffer.buffer is
    // typed as ArrayBuffer | SharedArrayBuffer in newer @types/node).
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    const parsed = parseGIF(ab) as unknown as GifParsed;
    // Truncated/corrupt GIFs make gifuct return NaN dimensions; ?? does not
    // coalesce NaN, so we have to gate explicitly.
    const rawW = parsed.lsd?.width;
    const rawH = parsed.lsd?.height;
    const w = typeof rawW === 'number' && Number.isFinite(rawW) ? rawW : 0;
    const h = typeof rawH === 'number' && Number.isFinite(rawH) ? rawH : 0;
    const frameCount = Array.isArray(parsed.frames) ? parsed.frames.length : 0;
    return estimateFor(w, h, frameCount, buf.byteLength, false);
  } catch {
    return estimateFor(0, 0, 0, buf.byteLength, false);
  }
}

function measureStatic(buf: Buffer): ImageEstimate {
  const dim = imageSize(buf);
  const w = dim.width ?? 0;
  const h = dim.height ?? 0;
  return estimateFor(w, h, 1, buf.byteLength, true);
}

function measureWebp(buf: Buffer): ImageEstimate {
  const animated = parseAnimatedWebpInfo(buf);
  if (animated) {
    return estimateFor(animated.width, animated.height, animated.frameCount, buf.byteLength, false);
  }
  return measureStatic(buf);
}

/**
 * Predict image memory costs given encoded bytes and extension. JPEG/PNG/static
 * WebP delegate to `image-size` for dimensions. GIF and animated WebP are parsed
 * to count frames. `bytes` remains the all-frame full-canvas materialization
 * estimate; `preloadBytes` is what the static bitmap preload cache should admit.
 *
 * Throws on unsupported extensions. Returns a zeroed estimate on parse
 * failure for GIFs (the album-load pipeline must not crash on one bad file).
 */
export function estimateFromBuffer(buf: Buffer, ext: SupportedExt): ImageEstimate {
  if (ext === '.gif') return measureGif(buf);
  if (ext === '.webp') return measureWebp(buf);
  if (STATIC_EXTS.has(ext)) return measureStatic(buf);
  throw new Error(`unsupported extension: ${ext}`);
}

export async function estimateFromFile(filePath: string): Promise<ImageEstimate> {
  const buf = await fs.promises.readFile(filePath);
  const i = filePath.lastIndexOf('.');
  const ext = (i >= 0 ? filePath.slice(i).toLowerCase() : '') as SupportedExt;
  return estimateFromBuffer(buf, ext);
}
