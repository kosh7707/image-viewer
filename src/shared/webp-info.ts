export interface AnimatedWebpInfo {
  width: number;
  height: number;
  frameCount: number;
}

/**
 * Parse only the WebP container metadata needed to distinguish animated WebP
 * from static WebP. This intentionally does not decode image payloads.
 */
export function parseAnimatedWebpInfo(bytes: Uint8Array): AnimatedWebpInfo | null {
  if (bytes.byteLength < 12 || !asciiEquals(bytes, 0, 'RIFF') || !asciiEquals(bytes, 8, 'WEBP')) {
    return null;
  }

  let hasAnimationFlag = false;
  let width = 0;
  let height = 0;
  let frameCount = 0;
  let offset = 12;

  while (offset + 8 <= bytes.byteLength) {
    const fourcc = readAscii(bytes, offset, offset + 4);
    const size = readUInt32LE(bytes, offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + size;
    const paddedEnd = payloadEnd + (size % 2);
    if (payloadEnd > bytes.byteLength || paddedEnd > bytes.byteLength) return null;

    if (fourcc === 'VP8X' && size >= 10) {
      hasAnimationFlag = (bytes[payloadStart]! & 0x02) !== 0;
      width = readUInt24LE(bytes, payloadStart + 4) + 1;
      height = readUInt24LE(bytes, payloadStart + 7) + 1;
    } else if (fourcc === 'ANMF') {
      frameCount += 1;
    }

    offset = paddedEnd;
  }

  if (!hasAnimationFlag || width <= 0 || height <= 0 || frameCount <= 0) return null;
  return { width, height, frameCount };
}

export function isAnimatedWebpBytes(bytes: Uint8Array): boolean {
  return parseAnimatedWebpInfo(bytes) !== null;
}

function asciiEquals(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.byteLength) return false;
  for (let i = 0; i < value.length; i += 1) {
    if (bytes[offset + i] !== value.charCodeAt(i)) return false;
  }
  return true;
}

function readAscii(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i += 1) {
    s += String.fromCharCode(bytes[i]!);
  }
  return s;
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}
