import { test } from 'node:test';
import * as assert from 'node:assert/strict';

type Listener = (event: FakeKeyboardEvent) => void;

interface FakeKeyboardEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
}

const listeners = new Map<string, Listener[]>();

const fakeWindow = {
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

import { installKeyboard } from '../src/renderer/input';

function keyEvent(key: string, opts: Partial<FakeKeyboardEvent> = {}): FakeKeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...opts,
  };
}

function dispatch(event: FakeKeyboardEvent): void {
  for (const listener of listeners.get('keydown') ?? []) {
    listener(event);
  }
}

function reset(): void {
  listeners.clear();
}

function handlers(calls: string[], exitBlocked = false) {
  return {
    onPrev: () => calls.push('prev'),
    onNext: () => calls.push('next'),
    onFullscreen: () => calls.push('fullscreen'),
    onSpeedDown: () => calls.push('speed-down'),
    onSpeedUp: () => calls.push('speed-up'),
    onExit: () => calls.push('exit'),
    isExitBlocked: () => exitBlocked,
  };
}

test('Escape exits immediately when no dialog blocks exit', () => {
  reset();
  const calls: string[] = [];
  const uninstall = installKeyboard(handlers(calls));
  const event = keyEvent('Escape');

  dispatch(event);

  assert.deepEqual(calls, ['exit']);
  assert.equal(event.defaultPrevented, true);
  uninstall();
});

test('Escape does not exit while a dialog blocks viewer-level exit', () => {
  reset();
  const calls: string[] = [];
  installKeyboard(handlers(calls, true));
  const event = keyEvent('Escape');

  dispatch(event);

  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
});

test('Escape with modifiers is ignored', () => {
  reset();
  const calls: string[] = [];
  installKeyboard(handlers(calls));
  const event = keyEvent('Escape', { ctrlKey: true });

  dispatch(event);

  assert.deepEqual(calls, []);
  assert.equal(event.defaultPrevented, false);
});
