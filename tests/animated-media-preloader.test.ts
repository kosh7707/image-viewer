import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { AnimatedMediaPreloader } from '../src/renderer/animated-media-preloader';
import { PreparedMediaCache, type PreparedMedia } from '../src/renderer/prepared-media-cache';
import type { AlbumEntryDTO } from '../src/preload/api';

test('AnimatedMediaPreloader prepares only animated entries in current-distance order', async () => {
  const cache = new PreparedMediaCache(1_000);
  cache.setOrder(['/a.gif', '/b.png', '/c.webp', '/d.gif', '/e.webp']);
  cache.setCurrentIndex(2);
  const calls: string[] = [];
  const preloader = new AnimatedMediaPreloader(cache, async (entry) => {
    calls.push(entry.path);
    return media(entry.path, 100);
  });

  await preloader.schedule(entries(), 2);

  assert.deepEqual(calls, ['/c.webp', '/d.gif', '/a.gif']);
  assert.equal(cache.has('/c.webp'), true);
  assert.equal(cache.has('/d.gif'), true);
  assert.equal(cache.has('/a.gif'), true);
  assert.equal(cache.has('/e.webp'), false, 'static WebP is skipped');
});

test('AnimatedMediaPreloader joins duplicate in-flight preparation', async () => {
  const cache = new PreparedMediaCache(1_000);
  cache.setOrder(['/a.gif']);
  cache.setCurrentIndex(0);
  let calls = 0;
  const release: Array<() => void> = [];
  const preloader = new AnimatedMediaPreloader(
    cache,
    (entry) =>
      new Promise<PreparedMedia>((resolve) => {
        calls += 1;
        release.push(() => resolve(media(entry.path, 100)));
      }),
  );

  const first = preloader.ensure(entry('/a.gif'), 0);
  const second = preloader.ensure(entry('/a.gif'), 0);
  assert.equal(release.length, 1);
  release[0]!();
  await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(cache.has('/a.gif'), true);
});

test('AnimatedMediaPreloader.clear prevents stale in-flight media from entering the cache', async () => {
  const cache = new PreparedMediaCache(1_000);
  cache.setOrder(['/old.gif']);
  cache.setCurrentIndex(0);
  const release: Array<() => void> = [];
  const preloader = new AnimatedMediaPreloader(
    cache,
    (entry) =>
      new Promise<PreparedMedia>((resolve) => {
        release.push(() => resolve(media(entry.path, 100)));
      }),
  );

  const preparing = preloader.ensure(entry('/old.gif'), 0);
  preloader.clear();
  release[0]!();

  assert.equal(await preparing, null);
  assert.equal(cache.has('/old.gif'), false);
});

test('AnimatedMediaPreloader schedule can preserve current media after a cap reduction', async () => {
  const cache = new PreparedMediaCache(200);
  const preloader = new AnimatedMediaPreloader(cache, async (entry) => media(entry.path, 20));
  const current = media('/current.gif', 80);
  const far = media('/far.gif', 80);
  cache.setOrder(['/current.gif', '/far.gif']);
  cache.setCurrentIndex(0);
  cache.put(current);
  cache.put(far);

  cache.setLimit(40, { protectCurrent: true });
  await preloader.schedule([entry('/current.gif'), entry('/far.gif')], 0, { protectCurrent: true });

  assert.equal(cache.has('/current.gif'), true);
  assert.equal(current.disposed, 0);
  assert.equal(cache.has('/far.gif'), false);
});

function entries(): AlbumEntryDTO[] {
  return [
    entry('/a.gif'),
    { path: '/b.png', mtimeMs: 1, frameCount: 1 },
    { path: '/c.webp', mtimeMs: 1, frameCount: 2 },
    entry('/d.gif'),
    { path: '/e.webp', mtimeMs: 1, frameCount: 1 },
  ];
}

function entry(path: string): AlbumEntryDTO {
  return { path, mtimeMs: 1, frameCount: path.endsWith('.gif') ? undefined : 2 };
}

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
