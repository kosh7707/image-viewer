import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadAlbum } from '../src/main/album-loader';
import type { WalkEntry } from '../src/main/walk';

function fakeWalk(entries: WalkEntry[]) {
  return (_root: string): WalkEntry[] => entries;
}

function sourceText(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

test('loadAlbum: empty folder returns empty status without a pre-measure pass', async () => {
  const r = await loadAlbum('/p', {
    walk: fakeWalk([]),
  });

  assert.equal(r.status, 'empty');
  assert.deepEqual(r.entries, []);
});

test('loadAlbum: non-empty folder returns walked entries without measuring or confirming', async () => {
  const entries: WalkEntry[] = [
    { path: '/p/a.png', mtimeMs: 1 },
    { path: '/p/b.gif', mtimeMs: 2 },
    { path: '/p/c.webp', mtimeMs: 3 },
  ];

  const r = await loadAlbum('/p', {
    walk: fakeWalk(entries),
  });

  assert.equal(r.status, 'ok');
  assert.deepEqual(r.entries, entries);
});

test('loadAlbum: metadata-less entries stay in the album for renderer-side preload/decode', async () => {
  const entries: WalkEntry[] = [
    { path: '/p/good.jpg', mtimeMs: 1 },
    { path: '/p/header-would-have-failed.gif', mtimeMs: 2 },
    { path: '/p/also-good.png', mtimeMs: 3 },
  ];

  const r = await loadAlbum('/p', {
    walk: fakeWalk(entries),
  });

  assert.equal(r.status, 'ok');
  assert.deepEqual(
    r.entries.map((entry) => entry.path),
    ['/p/good.jpg', '/p/header-would-have-failed.gif', '/p/also-good.png'],
  );
});

test('loadAlbum source has no whole-folder measurement, soft cap, or cancel branch', () => {
  const src = sourceText('src/main/album-loader.ts');
  for (const forbidden of [
    'DEFAULT_SOFT_CAP_BYTES',
    'ImageEstimate',
    'MeasuredWalkEntry',
    'measureFile',
    'confirmOverCap',
    'softCapBytes',
    'totalBytes',
    'measuring',
    'cancelled',
  ]) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not be in album-loader`);
  }
});
