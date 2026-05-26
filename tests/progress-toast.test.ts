import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ProgressToast } from '../src/renderer/progress-toast';

interface RuntimeGlobals {
  document?: {
    createElement(tagName: string): FakeElement;
  };
}

class FakeElement {
  className = '';
  textContent: string | null = null;
  parentNode: FakeElement | null = null;
  readonly children: FakeElement[] = [];

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const idx = this.children.indexOf(child);
    if (idx >= 0) this.children.splice(idx, 1);
    child.parentNode = null;
    return child;
  }
}

test('ProgressToast hides instead of sticking on an empty preload phase', () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldDocument = globals.document;
  globals.document = {
    createElement: () => new FakeElement(),
  };

  try {
    const host = new FakeElement();
    const toast = new ProgressToast(host as unknown as HTMLElement);

    toast.update({ phase: 'measuring', completed: 1, total: 2 });
    assert.equal(host.children.length, 1);

    toast.update({ phase: 'preloading', completed: 0, total: 0 });
    assert.equal(host.children.length, 0);
  } finally {
    globals.document = oldDocument;
  }
});
