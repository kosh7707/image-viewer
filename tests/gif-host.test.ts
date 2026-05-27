import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { GifHost } from '../src/renderer/gif-host';
import type { CanvasPainter } from '../src/renderer/canvas';

type RafCallback = (timestamp: number) => void;

const rafQueue: Array<{ id: number; callback: RafCallback }> = [];
let nextRafId = 1;

const rafGlobals = globalThis as unknown as {
  requestAnimationFrame: (callback: RafCallback) => number;
  cancelAnimationFrame: (id: number) => void;
};

rafGlobals.requestAnimationFrame = (callback: RafCallback): number => {
  const id = nextRafId++;
  rafQueue.push({ id, callback });
  return id;
};

rafGlobals.cancelAnimationFrame = (id: number): void => {
  const idx = rafQueue.findIndex((entry) => entry.id === id);
  if (idx >= 0) rafQueue.splice(idx, 1);
};

function resetRaf(): void {
  rafQueue.length = 0;
  nextRafId = 1;
}

function stepRaf(timestamp: number): void {
  const entry = rafQueue.shift();
  assert.ok(entry, `expected queued rAF at ${timestamp}`);
  entry.callback(timestamp);
}

function makePainter(draws: unknown[]): CanvasPainter {
  return {
    drawImage(source: unknown) {
      draws.push(source);
    },
  } as CanvasPainter;
}

function makeFrame(id: string): ImageBitmap {
  return { id, width: 1, height: 1 } as unknown as ImageBitmap;
}

test('GifHost speedMultiplier accelerates frame advancement for decoded animations', () => {
  resetRaf();
  const draws: unknown[] = [];
  const host = new GifHost(makePainter(draws));
  const frames = [makeFrame('a'), makeFrame('b'), makeFrame('c')];

  host.play({ frames, delays: [100, 100, 100] });
  assert.deepEqual(draws, [frames[0]]);

  stepRaf(0);
  stepRaf(50);
  assert.deepEqual(draws, [frames[0]], '50ms at 1x should not advance a 100ms frame');

  host.speedMultiplier = 2;
  stepRaf(100);
  assert.deepEqual(draws, [frames[0], frames[1]], '50ms more at 2x should advance');

  host.stop();
});

test('GifHost disposes owned animation frames on replacement and stop', () => {
  resetRaf();
  const draws: unknown[] = [];
  const host = new GifHost(makePainter(draws));
  let disposed = 0;

  host.play({ frames: [makeFrame('a')], delays: [100], dispose: () => (disposed += 1) });
  host.play({ frames: [makeFrame('b')], delays: [100], dispose: () => (disposed += 1) });
  assert.equal(disposed, 1, 'replacement disposes previous animation');

  host.stop();
  assert.equal(disposed, 2, 'stop disposes active animation once');

  host.stop();
  assert.equal(disposed, 2, 'second stop does not double-dispose');
});

test('GifHost does not dispose cache-owned animations when no disposer is supplied', () => {
  resetRaf();
  const draws: unknown[] = [];
  const host = new GifHost(makePainter(draws));
  let disposed = 0;
  const frame = { width: 1, height: 1, close: () => (disposed += 1) } as unknown as ImageBitmap;

  host.play({ frames: [frame], delays: [100] });
  host.stop();

  assert.equal(disposed, 0, 'cache-owned frames remain owned by the prepared-media cache');
});
