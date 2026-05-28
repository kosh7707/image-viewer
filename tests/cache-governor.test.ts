import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CacheGovernor, warmEntry, DEFAULT_MAX_BYTES } from '../src/renderer/cache-governor';

// Plain test fake matching BitmapLike (width/height + optional close).
function fakeBitmap(w: number, h: number, onClose?: () => void) {
  return {
    width: w,
    height: h,
    close: onClose ?? (() => undefined),
  };
}

test('admit then get returns the entry', () => {
  const g = new CacheGovernor();
  const bmp = fakeBitmap(100, 100);
  g.admit('a.jpg', bmp);
  assert.equal(g.size(), 1);
  assert.equal(g.has('a.jpg'), true);
  const entry = g.get('a.jpg');
  assert.ok(entry);
  assert.equal(entry!.bitmap, bmp);
  assert.equal(entry!.bytes, 100 * 100 * 4);
  assert.equal(entry!.warm, false);
});

test('count cap: 21st entry evicts the first', () => {
  const evicted: string[] = [];
  const g = new CacheGovernor({ onEvict: (p) => evicted.push(p) });
  for (let i = 0; i < 21; i++) {
    g.admit(`img-${i}.jpg`, fakeBitmap(10, 10));
  }
  assert.equal(g.size(), 20);
  // First inserted ('img-0.jpg') should be gone.
  assert.equal(g.has('img-0.jpg'), false);
  assert.equal(g.has('img-20.jpg'), true);
  assert.deepEqual(evicted, ['img-0.jpg']);
});

test('byte cap: one huge entry evicts everything else', () => {
  const g = new CacheGovernor();
  // Fill with some small entries.
  for (let i = 0; i < 5; i++) {
    g.admit(`small-${i}.jpg`, fakeBitmap(100, 100));
  }
  assert.equal(g.size(), 5);
  // Now admit a huge bitmap whose byte cost > 3 GB.
  // 30000 * 30000 * 4 = 3.6 GB.
  const huge = fakeBitmap(30000, 30000);
  g.admit('huge.jpg', huge);
  // The huge entry itself exceeds the cap; governor must evict at least
  // every other entry. Since the huge entry alone is over budget the
  // governor will keep evicting until the map is empty (it never evicts
  // the entry it just inserted — wait, the LRU policy here evicts the
  // OLDEST, which means it WILL evict the small entries first, then it
  // hits the huge entry as the oldest in the next loop iteration).
  // Per the policy in evictIfNeeded, it evicts oldest until both bounds
  // pass; eventually the huge entry itself becomes oldest and is evicted.
  assert.equal(g.size(), 0, 'all entries evicted because huge > maxBytes');
});

test('LRU touch on get: most-recently-used survives', () => {
  const g = new CacheGovernor({ maxEntries: 3 });
  g.admit('a', fakeBitmap(1, 1));
  g.admit('b', fakeBitmap(1, 1));
  g.admit('c', fakeBitmap(1, 1));
  // Touch 'a' so it's now the freshest.
  g.get('a');
  // Admit 'd' — should evict 'b' (now the oldest).
  g.admit('d', fakeBitmap(1, 1));
  assert.equal(g.has('a'), true);
  assert.equal(g.has('b'), false);
  assert.equal(g.has('c'), true);
  assert.equal(g.has('d'), true);
});

test('sorted-index policy evicts the farthest static preload first', () => {
  const g = new CacheGovernor({ maxBytes: 12 });
  g.setOrder(['/a.jpg', '/b.jpg', '/c.jpg', '/d.jpg']);
  g.setCurrentIndex(2);

  g.admit('/a.jpg', fakeBitmap(1, 1));
  g.admit('/b.jpg', fakeBitmap(1, 1));
  g.admit('/c.jpg', fakeBitmap(1, 1));
  g.admit('/d.jpg', fakeBitmap(1, 1));

  assert.equal(g.bytes(), 12);
  assert.equal(g.has('/c.jpg'), true, 'current entry survives');
  assert.equal(g.has('/b.jpg'), true, 'near previous survives');
  assert.equal(g.has('/d.jpg'), true, 'near next survives');
  assert.equal(g.has('/a.jpg'), false, 'farthest static preload is evicted');
});

test('retainOnly drops static entries outside the active RAM plan', () => {
  const g = new CacheGovernor({ maxBytes: 100 });
  g.admit('/far.jpg', fakeBitmap(1, 1));
  g.admit('/near.jpg', fakeBitmap(1, 1));

  g.retainOnly(new Set(['/near.jpg']));

  assert.equal(g.has('/near.jpg'), true);
  assert.equal(g.has('/far.jpg'), false);
  assert.equal(g.bytes(), 4);
});

test('evictAll empties the cache', () => {
  const g = new CacheGovernor();
  let closed = 0;
  for (let i = 0; i < 5; i++) {
    g.admit(
      `p-${i}`,
      fakeBitmap(2, 2, () => closed++),
    );
  }
  g.evictAll();
  assert.equal(g.size(), 0);
  assert.equal(g.bytes(), 0);
  assert.equal(closed, 5);
});

test('warmEntry sets warm flag via injected warmer', async () => {
  const g = new CacheGovernor();
  g.admit('w.jpg', fakeBitmap(10, 10));
  let called = 0;
  await warmEntry(g, 'w.jpg', () => {
    called++;
  });
  assert.equal(called, 1);
  assert.equal(g.get('w.jpg')!.warm, true);
  // Calling again is a no-op (already warm).
  await warmEntry(g, 'w.jpg', () => {
    called++;
  });
  assert.equal(called, 1);
});

test('readmit replaces and adjusts byte total', () => {
  const g = new CacheGovernor();
  g.admit('x', fakeBitmap(10, 10));
  const beforeBytes = g.bytes();
  g.admit('x', fakeBitmap(20, 20));
  assert.equal(g.size(), 1);
  assert.equal(g.bytes(), 20 * 20 * 4);
  assert.notEqual(g.bytes(), beforeBytes);
});

test('DEFAULT_MAX_BYTES is 3 GB', () => {
  assert.equal(DEFAULT_MAX_BYTES, 3_000_000_000);
});
