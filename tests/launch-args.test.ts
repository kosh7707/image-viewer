import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectLaunchPaths } from '../src/main/launch-args';

test('collectLaunchPaths keeps supported files and folders from Electron argv', () => {
  const root = path.join('C:', 'Pictures');
  const jpg = path.join(root, 'a.jpg');
  const eps = path.join(root, 'vector.eps');
  const ignoredTxt = path.join(root, 'note.txt');
  const seen = new Map<string, fs.Stats>([
    [root, stat('dir')],
    [jpg, stat('file')],
    [eps, stat('file')],
    [ignoredTxt, stat('file')],
  ]);

  const result = collectLaunchPaths(
    ['ImageViewer.exe', '.', '--flag', root, jpg, eps, ignoredTxt, jpg],
    (candidate) => seen.get(candidate) ?? null,
  );

  assert.deepEqual(result, [path.resolve(root), path.resolve(jpg), path.resolve(eps)]);
});

function stat(kind: 'dir' | 'file'): fs.Stats {
  return {
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  } as fs.Stats;
}
