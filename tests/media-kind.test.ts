import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { extOfPath, isPreloadableBitmapPath, mediaKindForPath } from '../src/renderer/media-kind';

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

test('isPreloadableBitmapPath excludes animated/native formats from createImageBitmap preload', () => {
  assert.equal(isPreloadableBitmapPath('/pics/a.gif'), false);
  assert.equal(isPreloadableBitmapPath('/pics/a.webp'), false);
  assert.equal(isPreloadableBitmapPath('/pics/a.png'), true);
});

test('extOfPath is case-insensitive and returns empty for extensionless paths', () => {
  assert.equal(extOfPath('/pics/A.JPEG'), '.jpeg');
  assert.equal(extOfPath('/pics/README'), '');
});
