import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { PreloadPanel } from '../src/renderer/preload-panel';

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

  toggle(name: string, force?: boolean): void {
    const enabled = force ?? !this.values.has(name);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }

  has(name: string): boolean {
    return this.values.has(name);
  }
}

class FakeElement {
  type = '';
  className = '';
  textContent: string | null = null;
  readonly classList = new FakeClassList();
  readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...children);
  }

  setAttribute(_name: string, _value: string): void {
    // Attribute values are not needed by this test fake.
  }

  addEventListener(name: string, cb: () => void): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(cb);
    this.listeners.set(name, listeners);
  }

  click(): void {
    for (const cb of this.listeners.get('click') ?? []) cb();
  }
}

test('PreloadPanel renders nearby ready/loading rows and supports pinning', () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldDocument = globals.document;
  const timers = fakeTimers();
  globals.document = {
    createElement: () => new FakeElement(),
  };

  try {
    const host = new FakeElement();
    const panel = new PreloadPanel(host as unknown as HTMLElement, {
      activeAfterUpdateMs: 1000,
      timers,
    });

    panel.update(
      {
        currentIndex: 1,
        total: 3,
        items: [
          { index: 1, path: '/p/current.gif', state: 'current', kind: 'animation' },
          { index: 2, path: '/p/next.webp', state: 'loading', kind: 'animation' },
          { index: 0, path: '/p/prev.jpg', state: 'ready', kind: 'static' },
        ],
      },
      { reveal: true },
    );

    assert.equal(host.children.length, 1);
    const node = host.children[0]!;
    assert.equal(node.className, 'preload-panel');
    assert.equal(node.classList.has('active'), true);
    assert.equal(node.children[1]!.textContent, '2 / 3');
    const list = node.children[2]!;
    assert.equal(list.children.length, 3);
    assert.equal(list.children[0]!.children[0]!.textContent, '●');
    assert.equal(list.children[1]!.children[0]!.textContent, '…');
    assert.equal(list.children[2]!.children[3]!.textContent, 'S');

    timers.fire(1);
    assert.equal(node.classList.has('active'), false);

    const pin = node.children[0]!.children[1]!;
    pin.click();

    assert.equal(panel.isPinned(), true);
    assert.equal(node.classList.has('pinned'), true);
    assert.equal(pin.textContent, '●');
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
