import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as ts from 'typescript';

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function runtimeStaticImportSpecifiers(file: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    readSource(file),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (statement.importClause?.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier;
    if (ts.isStringLiteralLike(specifier)) specifiers.push(specifier.text);
  }
  return specifiers;
}

test('main startup does not statically import the album loading stack', () => {
  const main = readSource('src/main/main.ts');
  const menu = readSource('src/main/menu.ts');

  assert.doesNotMatch(main, /from ['"]\.\/album-flow['"]/);
  assert.doesNotMatch(menu, /from ['"]\.\/album-flow['"]/);
});

test('main startup does not statically import preference storage or normalization', () => {
  const imports = runtimeStaticImportSpecifiers('src/main/main.ts');

  assert.ok(!imports.includes('./preferences'));
  assert.ok(!imports.includes('../shared/user-preferences'));
});

test('main startup does not statically import the RSS monitor', () => {
  const imports = runtimeStaticImportSpecifiers('src/main/main.ts');
  const main = readSource('src/main/main.ts');

  assert.ok(!imports.includes('./rss'));
  assert.match(main, /startRssMonitorForWindow/);
  assert.match(main, /stopRssMonitorIfLoaded/);
  assert.match(main, /did-finish-load/);
});

test('main startup does not statically import the context menu implementation', () => {
  const imports = runtimeStaticImportSpecifiers('src/main/main.ts');
  const main = readSource('src/main/main.ts');

  assert.ok(!imports.includes('./menu'));
  assert.match(main, /let animationSpeedMultiplier\s*=\s*1\.0/);
  assert.match(main, /animationSpeedMultiplier\s*=\s*saved\.animation\.speedMultiplier/);
  assert.match(main, /animationSpeedMultiplier\s*=\s*prefs\.animation\.speedMultiplier/);
  assert.match(main, /async function showContextMenuForWindow/);
  assert.match(main, /try\s*{[\s\S]*await loadMenuModule\(\)[\s\S]*catch\s*{/);
  assert.match(main, /if\s*\(\s*win\.isDestroyed\(\)\s*\)\s*return/);
  assert.match(
    main,
    /showContextMenu\(win,\s*point,\s*{[\s\S]*speedMultiplier:\s*animationSpeedMultiplier/,
  );
  assert.match(main, /openFile:\s*async\s*\(\)\s*=>/);
  assert.match(main, /openFolder:\s*async\s*\(\)\s*=>/);
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
  assert.match(readyBlock, /preferences-loaded/);
  assert.match(readyBlock, /preferences-load-failed/);
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
