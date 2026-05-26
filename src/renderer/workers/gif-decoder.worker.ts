/**
 * gif-decoder.worker.ts
 *
 * On `{type: 'parse', buffer}` parses a GIF using gifuct-js, generates
 * `ImageBitmap[]` (one per frame, with correct compositing) and `delays[]`,
 * and posts them back via `postMessage(payload, transferList)`.
 *
 * Frames are returned in canvas pixel-space (full GIF dims).
 */

/// <reference lib="webworker" />

import { parseGIF, decompressFrames, ParsedFrame } from 'gifuct-js';

declare const self: DedicatedWorkerGlobalScope;

interface ParseRequest {
  type: 'parse';
  buffer: ArrayBuffer;
}

interface ParsedResponse {
  type: 'parsed';
  frames: ImageBitmap[];
  delays: number[];
  width: number;
  height: number;
  totalBytes: number;
}

interface ErrorResponse {
  type: 'error';
  message: string;
}

// Image-bomb defenses: cap pixel area and frame count to prevent
// a malicious GIF from exhausting memory in the worker.
const MAX_GIF_PIXELS = 64 * 1024 * 1024; // 64 MP
const MAX_GIF_FRAMES = 5000;

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  if (!event.data || event.data.type !== 'parse') return;
  try {
    const buffer = event.data.buffer;
    const gif = parseGIF(buffer);
    // Validate logical-screen dimensions BEFORE decompressing frames.
    const lsdEarly = (gif as unknown as { lsd: { width: number; height: number } }).lsd;
    if (lsdEarly && lsdEarly.width * lsdEarly.height > MAX_GIF_PIXELS) {
      const tooBig: ErrorResponse = { type: 'error', message: 'gif too large' };
      self.postMessage(tooBig);
      self.close();
      return;
    }
    const frames: ParsedFrame[] = decompressFrames(gif, true);
    if (frames.length > MAX_GIF_FRAMES) {
      const tooMany: ErrorResponse = { type: 'error', message: 'gif too large' };
      self.postMessage(tooMany);
      self.close();
      return;
    }
    if (frames.length === 0) {
      const empty: ParsedResponse = {
        type: 'parsed',
        frames: [],
        delays: [],
        width: 0,
        height: 0,
        totalBytes: 0,
      };
      self.postMessage(empty);
      return;
    }
    // gifuct-js gives us the logical screen via gif.lsd.
    const lsd = (gif as unknown as { lsd: { width: number; height: number } }).lsd;
    const fullW = lsd.width;
    const fullH = lsd.height;

    // Compose each frame onto a persistent canvas to handle disposal modes.
    const composite = new OffscreenCanvas(fullW, fullH);
    const ctx = composite.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable in worker');

    const bitmaps: ImageBitmap[] = [];
    const delays: number[] = [];
    let totalBytes = 0;

    for (const frame of frames) {
      // Build per-frame ImageData from patch.
      const patchW = frame.dims.width;
      const patchH = frame.dims.height;
      const patchData = new ImageData(new Uint8ClampedArray(frame.patch), patchW, patchH);
      // Use a small scratch canvas for the patch so we can drawImage.
      const patchCanvas = new OffscreenCanvas(patchW, patchH);
      const patchCtx = patchCanvas.getContext('2d');
      if (!patchCtx) throw new Error('patch ctx');
      patchCtx.putImageData(patchData, 0, 0);

      // Disposal: 2 = restore to background; 3 = restore to previous.
      // For simplicity we treat 2 by clearing the patch region, others as keep.
      if (frame.disposalType === 2) {
        ctx.clearRect(frame.dims.left, frame.dims.top, patchW, patchH);
      }
      ctx.drawImage(patchCanvas, frame.dims.left, frame.dims.top);

      // Snapshot the full frame as an ImageBitmap.
      const bmp = await createImageBitmap(composite);
      bitmaps.push(bmp);
      // delay is in 1/100 sec; spec stores ms.
      const delayMs = frame.delay && frame.delay > 0 ? frame.delay : 100;
      delays.push(delayMs);
      totalBytes += fullW * fullH * 4;
    }

    const response: ParsedResponse = {
      type: 'parsed',
      frames: bitmaps,
      delays,
      width: fullW,
      height: fullH,
      totalBytes,
    };
    self.postMessage(response, bitmaps as unknown as Transferable[]);
  } catch (err) {
    const msg: ErrorResponse = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(msg);
  }
};

export {};
