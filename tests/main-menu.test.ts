import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';

test('main context menu module is stateless and option driven', () => {
  const source = fs.readFileSync('src/main/menu.ts', 'utf8');

  assert.doesNotMatch(source, /export\s+const\s+menuState/);
  assert.doesNotMatch(source, /configureMenuActions/);
  assert.doesNotMatch(source, /const\s+menuActions/);
  assert.match(source, /showContextMenu\([^)]*options:/);
  assert.match(source, /options\.speedMultiplier\.toFixed\(1\)/);
  assert.match(source, /options\.openFile\(win\)/);
  assert.match(source, /options\.openFolder\(win\)/);
});
