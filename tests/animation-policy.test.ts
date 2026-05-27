import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  MAX_ANIMATION_DECODE_BYTES,
  MAX_NATIVE_GIF_BYTES,
  shouldUseNativeAnimatedWebp,
  shouldUseNativeGif,
} from '../src/renderer/animation-policy';
import type { AlbumEntryDTO } from '../src/preload/api';

function entry(overrides: Partial<AlbumEntryDTO>): AlbumEntryDTO {
  return {
    path: '/p/a.webp',
    mtimeMs: 1,
    width: 10,
    height: 10,
    frameCount: 2,
    estimatedBytes: 0,
    encodedBytes: 100,
    allFramesDecodedBytes: 10 * 10 * 4 * 2,
    playbackBytes: 10 * 10 * 4 * 2,
    ...overrides,
  };
}

test('animated WebP uses native playback when all-frame decode exceeds cap', () => {
  assert.equal(
    shouldUseNativeAnimatedWebp(
      entry({
        path: '/p/huge.webp',
        allFramesDecodedBytes: MAX_ANIMATION_DECODE_BYTES + 1,
      }),
    ),
    true,
  );
  assert.equal(
    shouldUseNativeAnimatedWebp(
      entry({
        path: '/p/small.webp',
        allFramesDecodedBytes: MAX_ANIMATION_DECODE_BYTES,
      }),
    ),
    false,
  );
});

test('GIF native policy considers both compressed bytes and decoded all-frame bytes', () => {
  assert.equal(
    shouldUseNativeGif(
      entry({
        path: '/p/raw-heavy.gif',
        encodedBytes: MAX_NATIVE_GIF_BYTES + 1,
        allFramesDecodedBytes: 1,
      }),
    ),
    true,
  );
  assert.equal(
    shouldUseNativeGif(
      entry({
        path: '/p/decode-heavy.gif',
        encodedBytes: 1,
        allFramesDecodedBytes: MAX_ANIMATION_DECODE_BYTES + 1,
      }),
    ),
    true,
  );
});

test('animation policy stays permissive when album metadata is missing', () => {
  assert.equal(shouldUseNativeAnimatedWebp({ path: '/p/unknown.webp', mtimeMs: 1 }), false);
  assert.equal(shouldUseNativeGif({ path: '/p/unknown.gif', mtimeMs: 1 }), false);
});
