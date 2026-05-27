import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  NativeImageHost,
  nativeMimeForPath,
  type ObjectUrlAdapter,
} from '../src/renderer/native-image-host';

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

function fakeImage() {
  const removed: string[] = [];
  return {
    src: '',
    hidden: true,
    classList: new FakeClassList(),
    removeAttribute(name: string): void {
      removed.push(name);
      if (name === 'src') this.src = '';
    },
    removed,
  };
}

function fakeUrls() {
  let nextId = 1;
  const created: string[] = [];
  const revoked: string[] = [];
  const urls: ObjectUrlAdapter = {
    createObjectURL: () => {
      const url = `blob:fake-${nextId++}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url) => {
      revoked.push(url);
    },
  };
  return { urls, created, revoked };
}

test('NativeImageHost shows native images by un-hiding the overlay and activating it', () => {
  const img = fakeImage();
  const { urls, created, revoked } = fakeUrls();
  const host = new NativeImageHost(img as unknown as HTMLImageElement, urls);

  host.showBytes(new Uint8Array([1, 2, 3]), 'image/webp');

  assert.equal(img.hidden, false);
  assert.equal(img.src, 'blob:fake-1');
  assert.equal(img.classList.has('active'), true);
  assert.deepEqual(created, ['blob:fake-1']);
  assert.deepEqual(revoked, []);
});

test('NativeImageHost clears the overlay and revokes the active object URL', () => {
  const img = fakeImage();
  const { urls, revoked } = fakeUrls();
  const host = new NativeImageHost(img as unknown as HTMLImageElement, urls);

  host.showBytes(new Uint8Array([1]), 'image/gif');
  host.clear();

  assert.equal(img.hidden, true);
  assert.equal(img.src, '');
  assert.equal(img.classList.has('active'), false);
  assert.deepEqual(img.removed, ['src']);
  assert.deepEqual(revoked, ['blob:fake-1']);
});

test('NativeImageHost revokes the previous URL before replacing it', () => {
  const img = fakeImage();
  const { urls, revoked } = fakeUrls();
  const host = new NativeImageHost(img as unknown as HTMLImageElement, urls);

  host.showBytes(new Uint8Array([1]), 'image/gif');
  host.showBytes(new Uint8Array([2]), 'image/webp');

  assert.equal(img.src, 'blob:fake-2');
  assert.deepEqual(revoked, ['blob:fake-1']);
});

test('NativeImageHost can show validated file URLs without revoking them as object URLs', () => {
  const img = fakeImage();
  const { urls, revoked } = fakeUrls();
  const host = new NativeImageHost(img as unknown as HTMLImageElement, urls);

  host.showUrl('file:///C:/pics/a.gif');
  host.clear();

  assert.equal(img.src, '');
  assert.equal(img.hidden, true);
  assert.deepEqual(revoked, []);
});

test('nativeMimeForPath maps animated formats to browser image MIME types', () => {
  assert.equal(nativeMimeForPath('/p/a.GIF'), 'image/gif');
  assert.equal(nativeMimeForPath('/p/a.WEBP'), 'image/webp');
  assert.equal(nativeMimeForPath('/p/a.txt'), 'application/octet-stream');
});
