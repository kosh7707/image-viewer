import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
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

test('ProgressToast ignores renderer preload progress instead of showing a loading toast', () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldDocument = globals.document;
  globals.document = {
    createElement: () => new FakeElement(),
  };

  try {
    const host = new FakeElement();
    const toast = new ProgressToast(host as unknown as HTMLElement);

    toast.update({ phase: 'preloading', completed: 1, total: 2 });
    assert.equal(host.children.length, 0);
  } finally {
    globals.document = oldDocument;
  }
});

test('ProgressToast hides an existing scanning toast when preload progress arrives', () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldDocument = globals.document;
  globals.document = {
    createElement: () => new FakeElement(),
  };

  try {
    const host = new FakeElement();
    const toast = new ProgressToast(host as unknown as HTMLElement);

    toast.update({ phase: 'scanning', completed: 0, total: 0 });
    assert.equal(host.children.length, 1);

    toast.update({ phase: 'preloading', completed: 1, total: 2 });
    assert.equal(host.children.length, 0);
  } finally {
    globals.document = oldDocument;
  }
});

test('Album progress API and toast no longer expose a main-process measure phase', () => {
  for (const relativePath of ['src/preload/api.ts', 'src/renderer/progress-toast.ts']) {
    const src = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
    assert.equal(src.includes('measuring'), false, `${relativePath} must not expose measuring`);
  }
});

test('Renderer does not surface preload queue progress through the visible toast', () => {
  const rendererSrc = fs.readFileSync(path.join(process.cwd(), 'src/renderer/renderer.ts'), 'utf8');
  const toastSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/renderer/progress-toast.ts'),
    'utf8',
  );

  assert.equal(rendererSrc.includes("progressToast.update({ phase: 'preloading'"), false);
  assert.equal(toastSrc.includes('preloading:'), false);
});

test('ProgressToast shows an indeterminate scanning phase before exact totals are known', () => {
  const globals = globalThis as unknown as RuntimeGlobals;
  const oldDocument = globals.document;
  globals.document = {
    createElement: () => new FakeElement(),
  };

  try {
    const host = new FakeElement();
    const toast = new ProgressToast(host as unknown as HTMLElement);

    toast.update({ phase: 'scanning', completed: 0, total: 0 });

    assert.equal(host.children.length, 1);
    assert.equal(host.children[0]!.textContent, '파일 찾는 중...');
  } finally {
    globals.document = oldDocument;
  }
});
