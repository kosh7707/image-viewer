import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { loadAlbum, DEFAULT_SOFT_CAP_BYTES } from '../src/main/album-loader';
import type { WalkEntry } from '../src/main/walk';
import type { ImageEstimate } from '../src/main/measure';

function fakeWalk(entries: WalkEntry[]) {
  return (_root: string): WalkEntry[] => entries;
}

function fakeMeasure(byPath: Record<string, ImageEstimate>) {
  return async (filePath: string): Promise<ImageEstimate> => {
    const r = byPath[filePath];
    if (!r) throw new Error(`no measure for ${filePath}`);
    return r;
  };
}

const SMALL: ImageEstimate = { width: 100, height: 100, frameCount: 1, bytes: 40_000 };

test('loadAlbum: empty folder returns empty status', async () => {
  const r = await loadAlbum('/p', {
    walk: fakeWalk([]),
    measureFile: async () => SMALL,
    confirmOverCap: async () => true,
  });
  assert.equal(r.status, 'empty');
  assert.deepEqual(r.entries, []);
  assert.equal(r.totalBytes, 0);
});

test('loadAlbum: under cap returns ok with summed bytes, no confirm called', async () => {
  let confirmCalled = false;
  const entries: WalkEntry[] = [
    { path: '/p/a.png', mtimeMs: 1 },
    { path: '/p/b.jpg', mtimeMs: 2 },
  ];
  const r = await loadAlbum('/p', {
    walk: fakeWalk(entries),
    measureFile: fakeMeasure({ '/p/a.png': SMALL, '/p/b.jpg': SMALL }),
    confirmOverCap: async () => {
      confirmCalled = true;
      return true;
    },
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.entries.length, 2);
  assert.equal(r.totalBytes, 80_000);
  assert.equal(confirmCalled, false, 'confirm must not fire below cap');
});

test('loadAlbum: over cap with confirm yes returns ok', async () => {
  const huge: ImageEstimate = {
    width: 1, height: 1, frameCount: 1,
    bytes: DEFAULT_SOFT_CAP_BYTES + 1_000_000,
  };
  const entries: WalkEntry[] = [{ path: '/p/huge.jpg', mtimeMs: 1 }];
  const r = await loadAlbum('/p', {
    walk: fakeWalk(entries),
    measureFile: fakeMeasure({ '/p/huge.jpg': huge }),
    confirmOverCap: async () => true,
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.entries.length, 1);
  assert.ok(r.totalBytes > DEFAULT_SOFT_CAP_BYTES);
});

test('loadAlbum: over cap with confirm no returns cancelled', async () => {
  const huge: ImageEstimate = {
    width: 1, height: 1, frameCount: 1,
    bytes: DEFAULT_SOFT_CAP_BYTES + 1_000_000,
  };
  const entries: WalkEntry[] = [{ path: '/p/huge.jpg', mtimeMs: 1 }];
  const r = await loadAlbum('/p', {
    walk: fakeWalk(entries),
    measureFile: fakeMeasure({ '/p/huge.jpg': huge }),
    confirmOverCap: async () => false,
  });
  assert.equal(r.status, 'cancelled');
});

test('loadAlbum: confirm receives total bytes and file count', async () => {
  let receivedBytes = -1;
  let receivedCount = -1;
  const big: ImageEstimate = {
    width: 1, height: 1, frameCount: 1,
    bytes: DEFAULT_SOFT_CAP_BYTES + 100,
  };
  const entries: WalkEntry[] = [
    { path: '/p/a.jpg', mtimeMs: 1 },
    { path: '/p/b.jpg', mtimeMs: 2 },
  ];
  await loadAlbum('/p', {
    walk: fakeWalk(entries),
    measureFile: fakeMeasure({ '/p/a.jpg': big, '/p/b.jpg': SMALL }),
    confirmOverCap: async (totalBytes, fileCount) => {
      receivedBytes = totalBytes;
      receivedCount = fileCount;
      return true;
    },
  });
  assert.equal(receivedBytes, big.bytes + SMALL.bytes);
  assert.equal(receivedCount, 2);
});

test('loadAlbum: emits per-file progress during measure phase', async () => {
  const events: Array<{ phase: string; completed: number; total: number; bytesSoFar: number }> = [];
  const entries: WalkEntry[] = [
    { path: '/p/a.jpg', mtimeMs: 1 },
    { path: '/p/b.jpg', mtimeMs: 2 },
    { path: '/p/c.jpg', mtimeMs: 3 },
  ];
  await loadAlbum('/p', {
    walk: fakeWalk(entries),
    measureFile: fakeMeasure({
      '/p/a.jpg': SMALL,
      '/p/b.jpg': SMALL,
      '/p/c.jpg': SMALL,
    }),
    confirmOverCap: async () => true,
    onProgress: (phase, completed, total, bytesSoFar) =>
      events.push({ phase, completed, total, bytesSoFar }),
  });
  assert.equal(events.length, 3);
  assert.deepEqual(
    events.map((e) => e.completed),
    [1, 2, 3],
  );
  assert.equal(events[0]!.total, 3);
  assert.equal(events[2]!.bytesSoFar, SMALL.bytes * 3);
});

test('loadAlbum: per-file measure failure is skipped, others succeed', async () => {
  const entries: WalkEntry[] = [
    { path: '/p/good.jpg', mtimeMs: 1 },
    { path: '/p/bad.jpg', mtimeMs: 2 },
    { path: '/p/also-good.png', mtimeMs: 3 },
  ];
  const r = await loadAlbum('/p', {
    walk: fakeWalk(entries),
    measureFile: async (p) => {
      if (p === '/p/bad.jpg') throw new Error('decoder boom');
      return SMALL;
    },
    confirmOverCap: async () => true,
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.entries.length, 2, 'bad file dropped from album');
  assert.deepEqual(
    r.entries.map((e) => e.path).sort(),
    ['/p/also-good.png', '/p/good.jpg'],
  );
  assert.equal(r.totalBytes, SMALL.bytes * 2);
});

test('loadAlbum: DEFAULT_SOFT_CAP_BYTES is 4 GiB', () => {
  assert.equal(DEFAULT_SOFT_CAP_BYTES, 4 * 1024 * 1024 * 1024);
});
