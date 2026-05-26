import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { walkImages } from '../src/main/walk';

function tmpdir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `viewer-walk-${label}-`));
  return dir;
}

function touch(p: string, content = ''): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

test('walk: collects images at depth 1 sorted alphabetically', () => {
  const d = tmpdir('flat');
  touch(path.join(d, 'b.jpg'));
  touch(path.join(d, 'a.PNG'));
  touch(path.join(d, 'c.txt')); // non-image, must be skipped
  touch(path.join(d, 'd.webp'));
  touch(path.join(d, 'e.gif'));
  const result = walkImages(d);
  assert.deepEqual(
    result.map((r) => path.basename(r.path)),
    ['a.PNG', 'b.jpg', 'd.webp', 'e.gif'],
  );
});

test('walk: depth cap = 4, silently drops deeper', () => {
  const d = tmpdir('depth');
  // depth 1
  touch(path.join(d, 'd1.jpg'));
  // depth 2
  touch(path.join(d, 'a', 'd2.jpg'));
  // depth 3
  touch(path.join(d, 'a', 'b', 'd3.jpg'));
  // depth 4
  touch(path.join(d, 'a', 'b', 'c', 'd4.jpg'));
  // depth 5 — must be dropped silently
  touch(path.join(d, 'a', 'b', 'c', 'd', 'd5.jpg'));
  // depth 6 — must be dropped silently
  touch(path.join(d, 'a', 'b', 'c', 'd', 'e', 'd6.jpg'));
  const result = walkImages(d);
  const names = result.map((r) => path.basename(r.path)).sort();
  assert.deepEqual(names, ['d1.jpg', 'd2.jpg', 'd3.jpg', 'd4.jpg']);
});

test('walk: skips symlinks (no cycle following)', () => {
  const d = tmpdir('sym');
  touch(path.join(d, 'real.jpg'));
  // Symlinked directory back to parent — would cause infinite recursion if followed.
  try {
    fs.symlinkSync(d, path.join(d, 'loop'));
  } catch {
    // Symlink creation can fail on some FS; skip the assertion if so.
    return;
  }
  const result = walkImages(d);
  const names = result.map((r) => path.basename(r.path));
  // 'real.jpg' once; nothing duplicated via symlink loop.
  assert.equal(names.filter((n) => n === 'real.jpg').length, 1);
});

test('walk: skips hidden directories (leading dot)', () => {
  const d = tmpdir('hidden');
  touch(path.join(d, 'visible.jpg'));
  touch(path.join(d, '.hidden', 'shouldskip.jpg'));
  const result = walkImages(d);
  const names = result.map((r) => path.basename(r.path));
  assert.deepEqual(names, ['visible.jpg']);
});

test('walk: returns mtime per entry (for later sorting)', () => {
  const d = tmpdir('mtime');
  touch(path.join(d, 'a.jpg'));
  const result = walkImages(d);
  assert.equal(result.length, 1);
  assert.equal(typeof result[0]!.mtimeMs, 'number');
  assert.ok(result[0]!.mtimeMs > 0);
});

test('walk: empty directory returns empty array', () => {
  const d = tmpdir('empty');
  const result = walkImages(d);
  assert.deepEqual(result, []);
});

test('walk: extension matching is case-insensitive', () => {
  const d = tmpdir('case');
  touch(path.join(d, 'A.JPG'));
  touch(path.join(d, 'b.Jpeg'));
  touch(path.join(d, 'c.PnG'));
  touch(path.join(d, 'd.WeBp'));
  touch(path.join(d, 'e.GIF'));
  const result = walkImages(d);
  assert.equal(result.length, 5);
});
