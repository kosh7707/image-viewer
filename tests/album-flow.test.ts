import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { entriesToDTO } from '../src/main/album-flow';
import type { MeasuredWalkEntry } from '../src/main/album-loader';

test('entriesToDTO preserves measured metadata for renderer-side WebP routing', () => {
  const entries: MeasuredWalkEntry[] = [
    {
      path: '/p/static.webp',
      mtimeMs: 1,
      estimate: {
        width: 4,
        height: 3,
        frameCount: 1,
        bytes: 4 * 3 * 4,
        encodedBytes: 10,
        preloadBytes: 4 * 3 * 4,
        playbackBytes: 4 * 3 * 4,
      },
    },
    {
      path: '/p/animated.webp',
      mtimeMs: 2,
      estimate: {
        width: 4,
        height: 3,
        frameCount: 2,
        bytes: 4 * 3 * 4 * 2,
        encodedBytes: 20,
        preloadBytes: 0,
        playbackBytes: 4 * 3 * 4 * 2,
      },
    },
  ];

  assert.deepEqual(entriesToDTO(entries), [
    {
      path: '/p/static.webp',
      mtimeMs: 1,
      width: 4,
      height: 3,
      frameCount: 1,
      estimatedBytes: 4 * 3 * 4,
      encodedBytes: 10,
      allFramesDecodedBytes: 4 * 3 * 4,
      playbackBytes: 4 * 3 * 4,
    },
    {
      path: '/p/animated.webp',
      mtimeMs: 2,
      width: 4,
      height: 3,
      frameCount: 2,
      estimatedBytes: 0,
      encodedBytes: 20,
      allFramesDecodedBytes: 4 * 3 * 4 * 2,
      playbackBytes: 4 * 3 * 4 * 2,
    },
  ]);
});
