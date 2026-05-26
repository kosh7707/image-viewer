import * as fs from 'node:fs';
import { imageSize } from 'image-size';
import { parseGIF } from 'gifuct-js';

export type SupportedExt = '.jpg' | '.jpeg' | '.png' | '.webp' | '.gif';

export interface ImageEstimate {
  /** Predicted RGBA RAM in bytes once decoded. For GIF: width*height*4*frameCount. */
  bytes: number;
  width: number;
  height: number;
  /** Number of frames; 1 for static images. */
  frameCount: number;
}

const STATIC_EXTS: ReadonlySet<SupportedExt> = new Set(['.jpg', '.jpeg', '.png', '.webp']);

interface GifLsd {
  width: number;
  height: number;
}
interface GifParsed {
  lsd: GifLsd;
  frames: unknown[];
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
    return { width: w, height: h, frameCount, bytes: w * h * 4 * frameCount };
  } catch {
    return { width: 0, height: 0, frameCount: 0, bytes: 0 };
  }
}

function measureStatic(buf: Buffer): ImageEstimate {
  const dim = imageSize(buf);
  const w = dim.width ?? 0;
  const h = dim.height ?? 0;
  return { width: w, height: h, frameCount: 1, bytes: w * h * 4 };
}

/**
 * Predict the decoded RGBA RAM footprint of an image given its raw bytes
 * and extension. JPEG/PNG/WebP delegate to `image-size` for dimensions.
 * GIF is parsed via `gifuct-js` to count frames; each frame becomes a
 * full-canvas ImageBitmap in the decoder Worker, so total bytes scale
 * linearly with frame count.
 *
 * Throws on unsupported extensions. Returns a zeroed estimate on parse
 * failure for GIFs (the album-load pipeline must not crash on one bad file).
 */
export function estimateFromBuffer(buf: Buffer, ext: SupportedExt): ImageEstimate {
  if (ext === '.gif') return measureGif(buf);
  if (STATIC_EXTS.has(ext)) return measureStatic(buf);
  throw new Error(`unsupported extension: ${ext}`);
}

export async function estimateFromFile(filePath: string): Promise<ImageEstimate> {
  const buf = await fs.promises.readFile(filePath);
  const i = filePath.lastIndexOf('.');
  const ext = (i >= 0 ? filePath.slice(i).toLowerCase() : '') as SupportedExt;
  return estimateFromBuffer(buf, ext);
}
