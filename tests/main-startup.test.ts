import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

test('main startup does not statically import the album loading stack', () => {
  const main = readSource('src/main/main.ts');
  const menu = readSource('src/main/menu.ts');

  assert.doesNotMatch(main, /from ['"]\.\/album-flow['"]/);
  assert.doesNotMatch(menu, /from ['"]\.\/album-flow['"]/);
});

test('BrowserWindow creation is not blocked on preference loading', () => {
  const main = readSource('src/main/main.ts');
  const readyStart = main.indexOf('app.whenReady()');
  assert.notEqual(readyStart, -1, 'main.ts should wire app.whenReady');

  const readyBlock = main.slice(readyStart);
  const createWindowAt = readyBlock.indexOf('createWindow();');
  const loadPreferencesAt = readyBlock.indexOf('loadPreferences(');

  assert.notEqual(createWindowAt, -1, 'ready handler should create the window');
  assert.notEqual(loadPreferencesAt, -1, 'ready handler should still load preferences');
  assert.ok(
    createWindowAt < loadPreferencesAt,
    'window creation must happen before preference loading starts',
  );
});

test('renderer-ready timing is sent from renderer IPC, not only DOM readiness', () => {
  const api = readSource('src/preload/api.ts');
  const preload = readSource('src/preload/preload.ts');
  const main = readSource('src/main/main.ts');
  const renderer = readSource('src/renderer/renderer.ts');

  assert.match(api, /markRendererReady\(\): void/);
  assert.match(preload, /boot:renderer-ready/);
  assert.match(main, /ipcMain\.on\(['"]boot:renderer-ready['"]/);
  assert.match(renderer, /markRendererReady\(\)/);
});
