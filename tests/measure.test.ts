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
});

test('measure GIF single-frame: bytes = w*h*4*1', () => {
  const r = estimateFromBuffer(GIF_1x1_1FRAME, '.gif');
  assert.equal(r.width, 1);
  assert.equal(r.height, 1);
  assert.equal(r.frameCount, 1);
  assert.equal(r.bytes, 1 * 1 * 4 * 1);
});

test('measure GIF multi-frame: bytes scale with frame count', () => {
  const r = estimateFromBuffer(GIF_1x1_2FRAMES, '.gif');
  assert.equal(r.width, 1);
  assert.equal(r.height, 1);
  assert.equal(r.frameCount, 2);
  assert.equal(r.bytes, 1 * 1 * 4 * 2);
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
});
