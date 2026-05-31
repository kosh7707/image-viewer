import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { planPreloadBudgetCandidates } from '../src/renderer/preload-budget';

test('preload budget planner fills mixed static and animated entries from current outward', () => {
  const plan = planPreloadBudgetCandidates({
    currentIndex: 2,
    totalEntries: 6,
    totalLimit: 10,
    candidates: [
      { path: '/0.png', index: 0, kind: 'static', bytes: 4 },
      { path: '/1.gif', index: 1, kind: 'animated', bytes: 3 },
      { path: '/2.webp', index: 2, kind: 'animated', bytes: 4 },
      { path: '/3.jpg', index: 3, kind: 'static', bytes: 3 },
      { path: '/4.gif', index: 4, kind: 'animated', bytes: 99 },
      { path: '/5.png', index: 5, kind: 'static', bytes: 3 },
    ],
  });

  assert.deepEqual([...plan.allowedPaths], ['/2.webp', '/1.gif', '/3.jpg']);
  assert.equal(plan.animatedBytes, 7);
  assert.equal(plan.staticBytes, 3);
});

test('preload budget planner skips oversized near entries and keeps filling later smaller entries', () => {
  const plan = planPreloadBudgetCandidates({
    currentIndex: 0,
    totalEntries: 5,
    totalLimit: 8,
    candidates: [
      { path: '/0.gif', index: 0, kind: 'animated', bytes: 4 },
      { path: '/1.gif', index: 1, kind: 'animated', bytes: 99 },
      { path: '/2.png', index: 2, kind: 'static', bytes: 4 },
      { path: '/3.png', index: 3, kind: 'static', bytes: 4 },
      { path: '/4.webp', index: 4, kind: 'animated', bytes: 4 },
    ],
  });

  assert.deepEqual([...plan.allowedPaths], ['/0.gif', '/4.webp']);
  assert.equal(plan.animatedBytes, 8);
  assert.equal(plan.staticBytes, 0);
});

test('preload budget planner reserves remaining RAM for path-only static entries', () => {
  const plan = planPreloadBudgetCandidates({
    currentIndex: 0,
    totalEntries: 4,
    totalLimit: 100,
    candidates: [
      { path: '/0.png', index: 0, kind: 'static', bytes: null },
      { path: '/1.jpg', index: 1, kind: 'static', bytes: null },
      { path: '/2.gif', index: 2, kind: 'animated', bytes: 40 },
      { path: '/3.png', index: 3, kind: 'static', bytes: null },
    ],
  });

  assert.deepEqual([...plan.allowedPaths], ['/0.png', '/1.jpg', '/3.png', '/2.gif']);
  assert.equal(plan.animatedBytes, 40);
  assert.equal(plan.staticBytes, 60);
});

test('preload budget planner caps unknown static candidate count instead of admitting the whole album', () => {
  const candidates = Array.from({ length: 70 }, (_, index) => ({
    path: `/${index}.png`,
    index,
    kind: 'static' as const,
    bytes: null,
  }));

  const plan = planPreloadBudgetCandidates({
    currentIndex: 0,
    totalEntries: candidates.length,
    totalLimit: 64,
    candidates,
  });

  assert.equal(plan.allowedPaths.size, 64);
  assert.equal(plan.staticBytes, 64);
  assert.equal(plan.animatedBytes, 0);
});

test('renderer preload budget passes unknown static estimates to the planner', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src/renderer/renderer.ts'), 'utf8');

  assert.equal(
    src.includes('item.bytes !== null'),
    false,
    'renderer must not drop path-only static candidates before the planner can reserve RAM',
  );
  assert.equal(src.includes('item.bytes === null'), true);
});
