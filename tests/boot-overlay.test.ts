import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { hideBootOverlay } from '../src/renderer/boot-overlay';

class FakeClassList {
  readonly values = new Set<string>();
  add(value: string): void {
    this.values.add(value);
  }
  contains(value: string): boolean {
    return this.values.has(value);
  }
}

class FakeElement {
  readonly classList = new FakeClassList();
  readonly attrs = new Map<string, string>();
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
}

test('static boot overlay is present before renderer bundle execution', () => {
  const html = fs.readFileSync('src/renderer/index.html', 'utf8');
  const overlayAt = html.indexOf('id="boot-overlay"');
  const scriptAt = html.indexOf('<script type="module" src="renderer.js"></script>');

  assert.ok(overlayAt >= 0, 'index.html should contain boot overlay markup');
  assert.ok(scriptAt >= 0, 'index.html should load renderer.js as an ES module');
  assert.ok(overlayAt < scriptAt, 'boot overlay must be in HTML before renderer.js runs');
});

test('boot overlay styles include visible and hidden states', () => {
  const css = fs.readFileSync('src/renderer/styles.css', 'utf8');

  assert.match(css, /#boot-overlay/);
  assert.match(css, /boot-overlay--hidden/);
  assert.match(css, /boot-progress/);
});

test('renderer can hide the static boot overlay after initialization', () => {
  const overlay = new FakeElement();
  const fakeDocument = {
    getElementById: (id: string) => (id === 'boot-overlay' ? overlay : null),
  };

  hideBootOverlay(fakeDocument as unknown as Document);

  assert.equal(overlay.classList.contains('boot-overlay--hidden'), true);
  assert.equal(overlay.attrs.get('aria-hidden'), 'true');
});
