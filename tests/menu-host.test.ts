import { test } from 'node:test';
import * as assert from 'node:assert/strict';

type Listener = (event: FakeMouseEvent) => void;

interface FakeMouseEvent {
  button: number;
  clientX: number;
  clientY: number;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

const listeners = new Map<string, Listener[]>();
const calls: Array<{ method: string; value?: unknown }> = [];
let now = 1000;

const fakeWindow = {
  api: {
    updateSpeed(speed: number): Promise<void> {
      calls.push({ method: 'updateSpeed', value: speed });
      return Promise.resolve();
    },
    showContextMenu(point?: { x: number; y: number }): Promise<void> {
      calls.push({ method: 'showContextMenu', value: point });
      return Promise.resolve();
    },
  },
  addEventListener(event: string, listener: Listener): void {
    const bucket = listeners.get(event) ?? [];
    bucket.push(listener);
    listeners.set(event, bucket);
  },
  removeEventListener(event: string, listener: Listener): void {
    const bucket = listeners.get(event) ?? [];
    listeners.set(
      event,
      bucket.filter((existing) => existing !== listener),
    );
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).window = fakeWindow;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).performance = { now: () => now };

import { installContextMenu } from '../src/renderer/menu-host';

function fakeMouseEvent(button: number, x: number, y: number): FakeMouseEvent {
  return {
    button,
    clientX: x,
    clientY: y,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
  };
}

function dispatch(event: string, e: FakeMouseEvent): void {
  for (const listener of listeners.get(event) ?? []) {
    listener(e);
  }
}

function reset(): void {
  listeners.clear();
  calls.length = 0;
  now = 1000;
}

test('right-click opens context menu at the click point', () => {
  reset();
  const uninstall = installContextMenu(() => 1.5);
  const e = fakeMouseEvent(2, 111, 222);

  dispatch('contextmenu', e);

  assert.equal(e.defaultPrevented, true);
  assert.equal(e.propagationStopped, true);
  assert.deepEqual(calls, [
    { method: 'updateSpeed', value: 1.5 },
    { method: 'showContextMenu', value: { x: 111, y: 222 } },
  ]);

  uninstall();
});

test('mouseup fallback opens once and suppresses duplicate contextmenu', () => {
  reset();
  installContextMenu(() => 1.0);

  dispatch('mouseup', fakeMouseEvent(2, 10, 20));
  now += 50;
  dispatch('contextmenu', fakeMouseEvent(2, 10, 20));

  assert.equal(calls.filter((c) => c.method === 'showContextMenu').length, 1);
});

test('left mouseup does not open context menu', () => {
  reset();
  installContextMenu(() => 1.0);

  dispatch('mouseup', fakeMouseEvent(0, 10, 20));

  assert.deepEqual(calls, []);
});
