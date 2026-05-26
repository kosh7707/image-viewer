import { test } from 'node:test';
import * as assert from 'node:assert/strict';

// Browser-global stubs. Must be installed BEFORE the CanvasPainter constructor
// runs (which reads window.devicePixelRatio / innerWidth / innerHeight and
// calls window.addEventListener). The CanvasPainter module itself does not
// touch window at load time, so a static import after this block is fine.
type ResizeCallback = () => void;
const resizeListeners: ResizeCallback[] = [];
const fakeWindow = {
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 1,
  addEventListener(event: string, cb: ResizeCallback) {
    if (event === 'resize') resizeListeners.push(cb);
  },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = fakeWindow;

// eslint-disable-next-line @typescript-eslint/no-require-imports, import/first
import { CanvasPainter } from '../src/renderer/canvas';

interface FakeCtxCall {
  method: string;
  args: unknown[];
}

function makeFakeCanvas() {
  const calls: FakeCtxCall[] = [];
  const ctx = {
    fillStyle: '',
    imageSmoothingEnabled: false,
    imageSmoothingQuality: 'low' as ImageSmoothingQuality,
    fillRect(...args: unknown[]) {
      calls.push({ method: 'fillRect', args });
    },
    drawImage(...args: unknown[]) {
      calls.push({ method: 'drawImage', args });
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    style: {} as Record<string, string>,
    getContext: () => ctx,
  };
  return { canvas, ctx, calls };
}

function resetFakeWindow(w: number, h: number): void {
  fakeWindow.innerWidth = w;
  fakeWindow.innerHeight = h;
  resizeListeners.length = 0;
}

test('drawImage caches bitmap; subsequent resize replays it (fullscreen redraw)', () => {
  resetFakeWindow(800, 600);
  const { canvas, calls } = makeFakeCanvas();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const painter = new CanvasPainter(canvas as any);

  // Initial constructor resize: fillRect-clear only, no drawImage yet.
  assert.equal(calls.filter((c) => c.method === 'drawImage').length, 0);

  const bitmap = { width: 400, height: 300 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  painter.drawImage(bitmap as any);

  const drawsAfterPaint = calls.filter((c) => c.method === 'drawImage');
  assert.equal(drawsAfterPaint.length, 1, 'one draw after first drawImage');
  assert.strictEqual(drawsAfterPaint[0]!.args[0], bitmap);

  // Simulate fullscreen entry: window grew, resize event fires.
  fakeWindow.innerWidth = 1920;
  fakeWindow.innerHeight = 1080;
  for (const cb of resizeListeners) cb();

  // Canvas backbuffer dims updated to the new window size.
  assert.equal(canvas.width, 1920);
  assert.equal(canvas.height, 1080);

  // Cached bitmap replayed so the screen does not go black.
  const drawsAfterResize = calls.filter((c) => c.method === 'drawImage');
  assert.equal(drawsAfterResize.length, 2, 'second draw replays cached bitmap');
  assert.strictEqual(drawsAfterResize[1]!.args[0], bitmap);
});

test('resize before any drawImage does not paint stale content', () => {
  resetFakeWindow(800, 600);
  const { canvas, calls } = makeFakeCanvas();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new CanvasPainter(canvas as any);

  // Fire resize without ever drawing.
  fakeWindow.innerWidth = 1280;
  fakeWindow.innerHeight = 720;
  for (const cb of resizeListeners) cb();

  assert.equal(canvas.width, 1280);
  assert.equal(canvas.height, 720);

  const draws = calls.filter((c) => c.method === 'drawImage');
  assert.equal(draws.length, 0, 'no draw without prior bitmap');
});
