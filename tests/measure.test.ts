import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { estimateFromBuffer } from '../src/main/measure';
import { PNG_1x1, GIF_1x1_1FRAME, GIF_1x1_2FRAMES } from './fixtures';

test('measure PNG: returns width*height*4 with frameCount=1', () => {
  const r = estimateFromBuffer(PNG_1x1, '.png');
  assert.equal(r.width, 1);
  assert.equal(r.height, 1);
  assert.equal(r.frameCount, 1);
  assert.equal(r.bytes, 1 * 1 * 4);
  assert.equal(r.encodedBytes, PNG_1x1.byteLength);
  assert.equal(r.preloadBytes, 1 * 1 * 4);
  assert.equal(r.playbackBytes, 1 * 1 * 4);
});

test('measure GIF single-frame: all-frame bytes are distinct from preload bytes', () => {
  const r = estimateFromBuffer(GIF_1x1_1FRAME, '.gif');
  assert.equal(r.width, 1);
  assert.equal(r.height, 1);
  assert.equal(r.frameCount, 1);
  assert.equal(r.bytes, 1 * 1 * 4 * 1);
  assert.equal(r.encodedBytes, GIF_1x1_1FRAME.byteLength);
  assert.equal(r.preloadBytes, 0, 'GIFs are not decoded into the static preload cache');
  assert.equal(r.playbackBytes, 1 * 1 * 4);
});

test('measure GIF multi-frame: bytes scale with frame count', () => {
  const r = estimateFromBuffer(GIF_1x1_2FRAMES, '.gif');
  assert.equal(r.width, 1);
  assert.equal(r.height, 1);
  assert.equal(r.frameCount, 2);
  assert.equal(r.bytes, 1 * 1 * 4 * 2);
  assert.equal(r.preloadBytes, 0);
  assert.equal(r.playbackBytes, 1 * 1 * 4 * 2);
});

test('measure animated WebP: bytes scale with ANMF frame count', () => {
  const r = estimateFromBuffer(makeAnimatedWebpContainer(3, 2, 3), '.webp');
  assert.equal(r.width, 3);
  assert.equal(r.height, 2);
  assert.equal(r.frameCount, 3);
  assert.equal(r.bytes, 3 * 2 * 4 * 3);
  assert.equal(r.preloadBytes, 0, 'animated WebP is not decoded into the static preload cache');
  assert.equal(r.playbackBytes, 3 * 2 * 4 * 3);
});

test('measure: unsupported extension throws', () => {
  assert.throws(() => estimateFromBuffer(Buffer.from([0]), '.bmp' as '.png'));
});

test('measure: corrupt GIF returns a safe estimate (does not throw)', () => {
  // Half-cut GIF header. Parser should fail and we fall back to a conservative
  // estimate rather than crashing the whole album-load pipeline.
  const corrupt = Buffer.from('47494638', 'hex');
  const r = estimateFromBuffer(corrupt, '.gif');
  assert.ok(r.bytes >= 0, 'bytes is non-negative');
  assert.equal(r.frameCount, 0, 'no frames parsed');
  assert.equal(r.preloadBytes, 0);
});

test('measure: known dimensions => bytes formula scales', () => {
  // Synthetic dimensions via mock: PNG with 100x50 → 100*50*4 = 20000.
  // We construct a PNG header with width=100, height=50 explicitly.
  // PNG IHDR: width(4 BE), height(4 BE).
  const png100x50 = Buffer.from(
    '89504E470D0A1A0A0000000D49484452' +
      '00000064' +
      '00000032' +
      '0806000000' +
      '00000000' +
      '0000000049454E44AE426082',
    'hex',
  );
  const r = estimateFromBuffer(png100x50, '.png');
  assert.equal(r.width, 100);
  assert.equal(r.height, 50);
  assert.equal(r.bytes, 100 * 50 * 4);
  assert.equal(r.preloadBytes, 100 * 50 * 4);
  assert.equal(r.playbackBytes, 100 * 50 * 4);
});

function makeAnimatedWebpContainer(width: number, height: number, frameCount: number): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x02; // Animation flag.
  writeUInt24LE(vp8x, width - 1, 4);
  writeUInt24LE(vp8x, height - 1, 7);

  const chunks = [makeChunk('VP8X', vp8x), makeChunk('ANIM', Buffer.alloc(6))];
  for (let i = 0; i < frameCount; i += 1) {
    chunks.push(makeChunk('ANMF', Buffer.alloc(16)));
  }

  const body = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 4, 'ascii');
  return Buffer.concat([riff, body]);
}

function makeChunk(fourcc: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, 4, 'ascii');
  header.writeUInt32LE(payload.length, 4);
  return payload.length % 2 === 0
    ? Buffer.concat([header, payload])
    : Buffer.concat([header, payload, Buffer.from([0])]);
}

function writeUInt24LE(buf: Buffer, value: number, offset: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
}
