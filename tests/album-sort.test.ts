import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { sortAlbum, type AlbumEntry, type SortKey, type SortOrder } from '../src/renderer/album-sort';

function makeAlbum(): AlbumEntry[] {
  return [
    { path: '/p/c.jpg', mtimeMs: 300 },
    { path: '/p/a.png', mtimeMs: 100 },
    { path: '/p/b.gif', mtimeMs: 200 },
  ];
}

function run(album: AlbumEntry[], key: SortKey, order: SortOrder, currentPath: string) {
  return sortAlbum(album, key, order, currentPath);
}

test('sort by filename asc', () => {
  const r = run(makeAlbum(), 'filename', 'asc', '/p/c.jpg');
  assert.deepEqual(
    r.entries.map((e) => e.path),
    ['/p/a.png', '/p/b.gif', '/p/c.jpg'],
  );
  assert.equal(r.currentIndex, 2);
});

test('sort by filename desc', () => {
  const r = run(makeAlbum(), 'filename', 'desc', '/p/c.jpg');
  assert.deepEqual(
    r.entries.map((e) => e.path),
    ['/p/c.jpg', '/p/b.gif', '/p/a.png'],
  );
  assert.equal(r.currentIndex, 0);
});

test('sort by mtime asc', () => {
  const r = run(makeAlbum(), 'mtime', 'asc', '/p/c.jpg');
  assert.deepEqual(
    r.entries.map((e) => e.path),
    ['/p/a.png', '/p/b.gif', '/p/c.jpg'],
  );
  assert.equal(r.currentIndex, 2);
});

test('sort by mtime desc', () => {
  const r = run(makeAlbum(), 'mtime', 'desc', '/p/c.jpg');
  assert.deepEqual(
    r.entries.map((e) => e.path),
    ['/p/c.jpg', '/p/b.gif', '/p/a.png'],
  );
  assert.equal(r.currentIndex, 0);
});

test('sort preserves current path across re-sorts', () => {
  const album = makeAlbum();
  const asc = run(album, 'filename', 'asc', '/p/b.gif');
  assert.equal(asc.currentIndex, 1);
  const desc = run(asc.entries, 'filename', 'desc', asc.entries[asc.currentIndex]!.path);
  assert.equal(desc.entries[desc.currentIndex]!.path, '/p/b.gif');
});

test('sort handles current path not in album (returns index 0)', () => {
  const r = run(makeAlbum(), 'filename', 'asc', '/p/nonexistent.jpg');
  assert.equal(r.currentIndex, 0);
});

test('sort empty album returns empty + index 0', () => {
  const r = sortAlbum([], 'filename', 'asc', '');
  assert.deepEqual(r.entries, []);
  assert.equal(r.currentIndex, 0);
});

test('sort does not mutate input array', () => {
  const album = makeAlbum();
  const before = album.map((e) => e.path);
  sortAlbum(album, 'filename', 'asc', '/p/a.png');
  const after = album.map((e) => e.path);
  assert.deepEqual(after, before);
});

test('sort uses locale-aware filename ordering (case-insensitive)', () => {
  const album: AlbumEntry[] = [
    { path: '/p/Z.jpg', mtimeMs: 1 },
    { path: '/p/a.jpg', mtimeMs: 2 },
    { path: '/p/M.jpg', mtimeMs: 3 },
  ];
  const r = sortAlbum(album, 'filename', 'asc', '');
  assert.deepEqual(
    r.entries.map((e) => e.path),
    ['/p/a.jpg', '/p/M.jpg', '/p/Z.jpg'],
  );
});
