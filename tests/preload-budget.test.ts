import { test } from 'node:test';
import * as assert from 'node:assert/strict';
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
