import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { disposeFrames } from '../src/renderer/animation-disposal';

test('disposeFrames closes decoded frame resources and ignores close failures', () => {
  const closed: string[] = [];
  const frames = [
    { close: () => closed.push('first') },
    {
      close: () => {
        closed.push('throwing');
        throw new Error('already closed');
      },
    },
    { close: () => closed.push('last') },
  ];

  disposeFrames(frames);

  assert.deepEqual(closed, ['first', 'throwing', 'last']);
});
