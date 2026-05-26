import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

function readBuiltAsset(relativePath: string): string {
  const full = path.join(process.cwd(), relativePath);
  assert.equal(fs.existsSync(full), true, `${relativePath} must exist after npm run build`);
  return fs.readFileSync(full, 'utf8');
}

test('renderer browser bundle is not raw CommonJS output', () => {
  const js = readBuiltAsset(path.join('dist', 'src', 'renderer', 'renderer.js'));
  assert.match(js, /\(\(\) => \{/);
  assert.doesNotMatch(js, /^"use strict";\s*Object\.defineProperty\s*\(\s*exports/m);
  assert.doesNotMatch(js, /^Object\.defineProperty\s*\(\s*exports/m);
});

test('GIF worker browser bundle is not raw CommonJS output', () => {
  const js = readBuiltAsset(
    path.join('dist', 'src', 'renderer', 'workers', 'gif-decoder.worker.js'),
  );
  assert.match(js, /\(\(\) => \{/);
  assert.doesNotMatch(js, /^"use strict";\s*Object\.defineProperty\s*\(\s*exports/m);
  assert.doesNotMatch(js, /^Object\.defineProperty\s*\(\s*exports/m);
});
