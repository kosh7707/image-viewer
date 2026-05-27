import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PositionHud } from '../src/renderer/position-hud';

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

test('PositionHud shows one-based album position and hides after a delay', () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldDocument = globals.document;
  const timers = fakeTimers();
  globals.document = {
    createElement: () => new FakeElement(),
  };

  try {
    const host = new FakeElement();
    const hud = new PositionHud(host as unknown as HTMLElement, {
      hideAfterMs: 900,
      timers,
    });

    hud.show({ index: 11, total: 384, path: 'C:\\pics\\current.webp' });

    assert.equal(host.children.length, 1);
    const node = host.children[0]!;
    assert.equal(node.className, 'position-hud');
    assert.equal(node.classList.has('active'), true);
    assert.equal(node.children[0]!.textContent, '12 / 384');
    assert.equal(node.children[1]!.textContent, 'current.webp');

    timers.fire(1);

    assert.equal(node.classList.has('active'), false);
  } finally {
    globals.document = oldDocument;
  }
});

function fakeTimers() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  return {
    setTimeout(callback: () => void): number {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id: number): void {
      callbacks.delete(id);
    },
    fire(id: number): void {
      callbacks.get(id)?.();
    },
  };
}
