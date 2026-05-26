import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  extOfPath,
  isPreloadableBitmapEntry,
  isPreloadableBitmapPath,
  mediaKindForEntry,
  mediaKindForPath,
} from '../src/renderer/media-kind';

test('mediaKindForPath routes GIFs to the animated GIF pipeline', () => {
  assert.equal(mediaKindForPath('C:\\pics\\motion.GIF'), 'animated-gif');
});

test('mediaKindForPath routes WebP through the animated-capable WebP pipeline', () => {
  assert.equal(mediaKindForPath('/pics/animated.WEBP'), 'webp');
});

test('mediaKindForPath keeps static bitmap formats on the canvas/cache path', () => {
  assert.equal(mediaKindForPath('/pics/a.jpg'), 'static-bitmap');
  assert.equal(mediaKindForPath('/pics/a.jpeg'), 'static-bitmap');
  assert.equal(mediaKindForPath('/pics/a.png'), 'static-bitmap');
});

test('isPreloadableBitmapPath keeps metadata-less WebP on the safe animated/native path', () => {
  assert.equal(isPreloadableBitmapPath('/pics/a.gif'), false);
  assert.equal(isPreloadableBitmapPath('/pics/a.webp'), false);
  assert.equal(isPreloadableBitmapPath('/pics/a.png'), true);
});

test('extOfPath is case-insensitive and returns empty for extensionless paths', () => {
  assert.equal(extOfPath('/pics/A.JPEG'), '.jpeg');
  assert.equal(extOfPath('/pics/README'), '');
});

test('mediaKindForEntry uses measured WebP frame count to distinguish static and animated files', () => {
  assert.equal(
    mediaKindForEntry({ path: '/pics/static.webp', mtimeMs: 1, frameCount: 1 }),
    'static-bitmap',
  );
  assert.equal(
    mediaKindForEntry({ path: '/pics/animated.webp', mtimeMs: 1, frameCount: 2 }),
    'webp',
  );
  assert.equal(mediaKindForEntry({ path: '/pics/unknown.webp', mtimeMs: 1 }), 'webp');
});

test('isPreloadableBitmapEntry preloads static WebP but not animated or unknown WebP', () => {
  assert.equal(
    isPreloadableBitmapEntry({ path: '/pics/static.webp', mtimeMs: 1, frameCount: 1 }),
    true,
  );
  assert.equal(
    isPreloadableBitmapEntry({ path: '/pics/animated.webp', mtimeMs: 1, frameCount: 2 }),
    false,
  );
  assert.equal(isPreloadableBitmapEntry({ path: '/pics/unknown.webp', mtimeMs: 1 }), false);
  assert.equal(isPreloadableBitmapEntry({ path: '/pics/a.png', mtimeMs: 1 }), true);
});
