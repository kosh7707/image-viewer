import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { SpeedHud } from '../src/renderer/speed-hud';

interface RuntimeGlobals {
  document?: {
    createElement(tagName: string): FakeElement;
  };
}

class FakeClassList {
  readonly values = new Set<string>();

  add(name: string): void {
    this.values.add(name);
  }

  remove(name: string): void {
    this.values.delete(name);
  }

  has(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement {
  className = '';
  textContent: string | null = null;
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
}

test('SpeedHud shows the latest speed and auto-hides after the configured delay', () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldDocument = globals.document;
  const timers = fakeTimers();
  globals.document = {
    createElement: () => new FakeElement(),
  };

  try {
    const host = new FakeElement();
    const hud = new SpeedHud(host as unknown as HTMLElement, {
      hideAfterMs: 750,
      timers,
    });

    hud.show(1.234);

    assert.equal(host.children.length, 1);
    assert.equal(host.children[0]!.className, 'speed-hud');
    assert.equal(host.children[0]!.textContent, '1.2×');
    assert.equal(host.children[0]!.classList.has('active'), true);
    assert.deepEqual(timers.scheduledMs, [750]);

    hud.show(2);

    assert.equal(host.children.length, 1, 'HUD node is reused');
    assert.equal(host.children[0]!.textContent, '2.0×');
    assert.deepEqual(timers.cleared, [1]);
    assert.deepEqual(timers.scheduledMs, [750, 750]);

    timers.fire(2);

    assert.equal(host.children[0]!.classList.has('active'), false);
  } finally {
    globals.document = oldDocument;
  }
});

function fakeTimers() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  const scheduledMs: number[] = [];
  const cleared: number[] = [];
  return {
    scheduledMs,
    cleared,
    setTimeout(callback: () => void, ms: number): number {
      const id = nextId++;
      callbacks.set(id, callback);
      scheduledMs.push(ms);
      return id;
    },
    clearTimeout(id: number): void {
      callbacks.delete(id);
      cleared.push(id);
    },
    fire(id: number): void {
      callbacks.get(id)?.();
    },
  };
}
