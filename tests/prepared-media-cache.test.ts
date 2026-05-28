import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PreparedMediaCache, type PreparedMedia } from '../src/renderer/prepared-media-cache';

test('PreparedMediaCache evicts farthest entries from current sorted index first', () => {
  const cache = new PreparedMediaCache(90);
  cache.setOrder(['/a.gif', '/b.gif', '/c.gif', '/d.gif', '/e.gif']);
  cache.setCurrentIndex(0);

  cache.put(media('/a.gif', 30));
  cache.put(media('/b.gif', 30));
  cache.put(media('/c.gif', 30));
  cache.put(media('/d.gif', 30));

  assert.equal(cache.has('/a.gif'), true, 'current entry is retained');
  assert.equal(cache.has('/b.gif'), true, 'near entry is retained');
  assert.equal(cache.has('/d.gif'), true, 'newer tied far entry is retained');
  assert.equal(cache.has('/c.gif'), false, 'oldest farthest tied entry is evicted');
  assert.equal(cache.totalBytes(), 90);
});

test('PreparedMediaCache protects current media and disposes only on cache eviction', () => {
  const cache = new PreparedMediaCache(50);
  cache.setOrder(['/a.gif', '/b.gif']);
  cache.setCurrentIndex(1);
  const a = media('/a.gif', 30);
  const b = media('/b.gif', 30);

  cache.put(a);
  cache.put(b);

  assert.equal(cache.has('/a.gif'), false);
  assert.equal(cache.has('/b.gif'), true);
  assert.equal(a.disposed, 1);
  assert.equal(b.disposed, 0);

  const playable = cache.toPlayable('/b.gif');
  assert.ok(playable);
  assert.equal('dispose' in playable, false, 'playback leases are non-owning');

  cache.clear();
  assert.equal(b.disposed, 1);
});

test('PreparedMediaCache lowering the limit evicts farthest entries under the new cap', () => {
  const cache = new PreparedMediaCache(200);
  cache.setOrder(['/a.gif', '/b.gif', '/c.gif', '/d.gif', '/e.gif']);
  cache.setCurrentIndex(2);
  for (const path of ['/a.gif', '/b.gif', '/c.gif', '/d.gif', '/e.gif']) {
    cache.put(media(path, 40));
  }

  cache.setLimit(120);

  assert.equal(cache.totalBytes(), 120);
  assert.equal(cache.has('/c.gif'), true, 'current stays');
  assert.equal(cache.has('/b.gif') || cache.has('/d.gif'), true, 'near neighbors survive');
  assert.equal(
    cache.has('/a.gif') && cache.has('/e.gif'),
    false,
    'not both farthest entries survive',
  );
});

test('PreparedMediaCache can lower the limit while explicitly preserving current playback', () => {
  const cache = new PreparedMediaCache(200);
  cache.setOrder(['/a.gif', '/b.gif']);
  cache.setCurrentIndex(0);
  const current = media('/a.gif', 80);
  const far = media('/b.gif', 80);
  cache.put(current);
  cache.put(far);

  cache.setLimit(40, { protectCurrent: true });

  assert.equal(cache.has('/a.gif'), true, 'current media survives even when it exceeds cap');
  assert.equal(cache.has('/b.gif'), false);
  assert.equal(current.disposed, 0);
  assert.equal(far.disposed, 1);
  assert.equal(cache.totalBytes(), 80);
});

test('PreparedMediaCache retainOnly prunes stale preloads but can protect current playback', () => {
  const cache = new PreparedMediaCache(200);
  cache.setOrder(['/current.gif', '/stale.gif']);
  cache.setCurrentIndex(0);
  const current = media('/current.gif', 80);
  const stale = media('/stale.gif', 80);
  cache.put(current);
  cache.put(stale);

  cache.retainOnly(new Set(), { protectCurrent: true });

  assert.equal(cache.has('/current.gif'), true);
  assert.equal(cache.has('/stale.gif'), false);
  assert.equal(current.disposed, 0);
  assert.equal(stale.disposed, 1);
});

test('PreparedMediaCache evicts oversized inserted media when current protection is not requested', () => {
  const cache = new PreparedMediaCache(40);
  cache.setOrder(['/a.gif']);
  cache.setCurrentIndex(0);
  const oversized = media('/a.gif', 80);

  assert.equal(cache.put(oversized), false);
  assert.equal(cache.has('/a.gif'), false);
  assert.equal(oversized.disposed, 1);
});

test('PreparedMediaCache can insert oversized current media with explicit protection', () => {
  const cache = new PreparedMediaCache(40);
  cache.setOrder(['/a.gif']);
  cache.setCurrentIndex(0);
  const oversized = media('/a.gif', 80);

  assert.equal(cache.put(oversized, { protectCurrent: true }), true);
  assert.equal(cache.has('/a.gif'), true);
  assert.equal(oversized.disposed, 0);
});

test('PreparedMediaCache can proactively evict far entries before a decode reservation', () => {
  const cache = new PreparedMediaCache(100);
  cache.setOrder(['/a.gif', '/b.gif', '/c.gif']);
  cache.setCurrentIndex(0);
  const current = media('/a.gif', 30);
  const near = media('/b.gif', 30);
  const far = media('/c.gif', 30);
  cache.put(current);
  cache.put(near);
  cache.put(far);

  assert.equal(cache.makeRoomFor(50, { protectCurrent: true }), true);

  assert.equal(cache.has('/a.gif'), true, 'current entry is protected');
  assert.equal(cache.totalBytes(), 30, 'enough old entries are evicted before decoding');
  assert.equal(near.disposed + far.disposed, 2);
});

test('PreparedMediaCache refuses a reservation that only protected media could satisfy', () => {
  const cache = new PreparedMediaCache(40);
  cache.setOrder(['/a.gif']);
  cache.setCurrentIndex(0);
  const current = media('/a.gif', 40);
  cache.put(current);

  assert.equal(cache.makeRoomFor(1, { protectCurrent: true }), false);
  assert.equal(cache.has('/a.gif'), true);
  assert.equal(current.disposed, 0);
});

function media(path: string, bytes: number): PreparedMedia & { disposed: number } {
  return {
    kind: 'animation',
    path,
    bytes,
    frames: [{} as ImageBitmap],
    delays: [100],
    disposed: 0,
    dispose() {
      this.disposed += 1;
    },
  };
}
