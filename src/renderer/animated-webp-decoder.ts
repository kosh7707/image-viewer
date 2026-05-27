/**
 * WebCodecs-backed animated WebP decoder.
 *
 * Chromium's normal image element can play animated WebP, but it cannot expose
 * frame timing for the app's GIF-style speed controls. ImageDecoder gives us
 * frame-by-frame access; static/unsupported/failing files return null so the
 * renderer can fall back to native `<img>` playback.
 */

import { disposeFrames } from './animation-disposal';

export interface DecodedAnimation {
  frames: ImageBitmap[];
  delays: number[];
  /** Release frame bitmaps owned by this decoded animation. */
  dispose?: () => void;
}

export interface ImageDecoderLike {
  readonly completed: Promise<void>;
  readonly tracks: ImageTrackList;
  close(): void;
  decode(options?: ImageDecodeOptions): Promise<ImageDecodeResult>;
}

export interface ImageDecoderConstructorLike {
  new (init: ImageDecoderInit): ImageDecoderLike;
  isTypeSupported(type: string): Promise<boolean>;
}

export type CreateImageBitmapLike = (source: ImageBitmapSource) => Promise<ImageBitmap>;

export interface DecodeAnimatedWebpDeps {
  imageDecoder?: ImageDecoderConstructorLike;
  createImageBitmap?: CreateImageBitmapLike;
  signal?: AbortSignal;
  maxDecodedBytes?: number;
}

const WEBP_MIME = 'image/webp';
const DEFAULT_FRAME_DELAY_MS = 100;

export function durationUsToMs(durationUs: number | null | undefined): number {
  if (typeof durationUs !== 'number' || !Number.isFinite(durationUs) || durationUs <= 0) {
    return DEFAULT_FRAME_DELAY_MS;
  }
  return Math.max(1, durationUs / 1000);
}

export async function decodeAnimatedWebp(
  bytes: Uint8Array,
  deps: DecodeAnimatedWebpDeps = {},
): Promise<DecodedAnimation | null> {
  const ImageDecoderCtor = deps.imageDecoder ?? getImageDecoder();
  const makeBitmap = deps.createImageBitmap ?? getCreateImageBitmap();
  if (!ImageDecoderCtor || !makeBitmap) return null;
  if (deps.signal?.aborted) return null;

  try {
    if (!(await ImageDecoderCtor.isTypeSupported(WEBP_MIME))) return null;
    if (deps.signal?.aborted) return null;
  } catch {
    return null;
  }

  const frames: ImageBitmap[] = [];
  let totalDecodedBytes = 0;
  let decoder: ImageDecoderLike | null = null;
  try {
    decoder = new ImageDecoderCtor({
      data: copyToArrayBuffer(bytes),
      type: WEBP_MIME,
      preferAnimation: true,
    });

    await decoder.tracks.ready;
    if (deps.signal?.aborted) return null;
    await decoder.completed;
    if (deps.signal?.aborted) return null;

    const track = decoder.tracks.selectedTrack;
    const frameCount = track?.frameCount ?? 0;
    if (!track?.animated || frameCount < 2) return null;

    const delays: number[] = [];
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (deps.signal?.aborted) return abortDecode(frames);
      let videoFrame: VideoFrame | null = null;
      try {
        const result = await decoder.decode({ frameIndex });
        if (deps.signal?.aborted) return abortDecode(frames);
        videoFrame = result.image;
        const nextFrameBytes = videoFrame.displayWidth * videoFrame.displayHeight * 4;
        if (
          typeof deps.maxDecodedBytes === 'number' &&
          Number.isFinite(deps.maxDecodedBytes) &&
          totalDecodedBytes + nextFrameBytes > deps.maxDecodedBytes
        ) {
          throw new Error('animated WebP decoded frames exceed memory limit');
        }
        delays.push(durationUsToMs(videoFrame.duration));
        frames.push(await makeBitmap(videoFrame));
        totalDecodedBytes += nextFrameBytes;
        if (deps.signal?.aborted) return abortDecode(frames);
      } finally {
        try {
          videoFrame?.close();
        } catch {
          // Ignore cleanup failures; a decode failure still falls back to native playback.
        }
      }
    }

    decoder.close();
    decoder = null;
    return {
      frames,
      delays,
      dispose: () => disposeFrames(frames),
    };
  } catch {
    disposeFrames(frames);
    return null;
  } finally {
    try {
      decoder?.close();
    } catch {
      // ignore
    }
  }
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function getImageDecoder(): ImageDecoderConstructorLike | undefined {
  return (globalThis as unknown as { ImageDecoder?: ImageDecoderConstructorLike }).ImageDecoder;
}

function getCreateImageBitmap(): CreateImageBitmapLike | undefined {
  return (globalThis as unknown as { createImageBitmap?: CreateImageBitmapLike }).createImageBitmap;
}

function abortDecode(frames: ImageBitmap[]): null {
  disposeFrames(frames);
  return null;
}
