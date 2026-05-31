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

test('main startup does not statically import the fullscreen window helper', () => {
  const imports = runtimeStaticImportSpecifiers('src/main/main.ts');
  const main = readSource('src/main/main.ts');

  assert.ok(!imports.includes('./window'));
  assert.match(main, /let windowModulePromise/);
  assert.match(main, /windowModulePromise\s*=\s*null/);
  assert.match(main, /async function toggleFullscreenForWindow/);
  assert.match(main, /try\s*{[\s\S]*await loadWindowModule\(\)[\s\S]*catch\s*{/);
  assert.match(main, /if\s*\(\s*win\.isDestroyed\(\)\s*\)\s*return false/);
  assert.match(main, /catch\s*{[\s\S]*return false/);
  assert.match(main, /if\s*\(\s*!win\s*\)\s*return false/);
  assert.match(main, /return await toggleFullscreenForWindow\(win\)/);
});

test('main startup does not statically import folder extension constants', () => {
  const imports = runtimeStaticImportSpecifiers('src/main/main.ts');
  const main = readSource('src/main/main.ts');

  assert.ok(!imports.includes('./folder'));
  assert.match(main, /const READABLE_IMAGE_EXTS\s*=/);
  assert.match(main, /READABLE_IMAGE_EXTS as readonly string\[\]/);
});

test('main startup does not statically import boot timing diagnostics', () => {
  const imports = runtimeStaticImportSpecifiers('src/main/main.ts');
  const main = readSource('src/main/main.ts');
  const loggerStateAt = main.indexOf('let bootLoggerPromise');
  const firstBootLogAt = main.indexOf("logBootEvent('main-start')");

  assert.ok(!imports.includes('./boot-timing'));
  assert.match(main, /IMAGEVIEWER_BOOT_LOG_DIR/);
  assert.match(main, /import\(['"]\.\/boot-timing['"]\)/);
  assert.doesNotMatch(main, /layout\?\.logsDir/);
  assert.ok(loggerStateAt >= 0, 'boot logger state should exist');
  assert.ok(firstBootLogAt >= 0, 'main-start boot event should exist');
  assert.ok(loggerStateAt < firstBootLogAt, 'boot logger state must initialize before first log');
  assert.match(
    main,
    /function logBootEvent[\s\S]*try\s*{[\s\S]*loadBootLogger\(\)[\s\S]*catch\s*{/,
  );
});

test('BrowserWindow creation does not start eager preference loading', () => {
  const main = readSource('src/main/main.ts');
  const readyStart = main.indexOf('app.whenReady()');
  assert.notEqual(readyStart, -1, 'main.ts should wire app.whenReady');

  const readyBlock = main.slice(readyStart);

  assert.match(readyBlock, /createWindow\(\);/);
  assert.doesNotMatch(readyBlock, /loadPreferences\(/);
  assert.doesNotMatch(readyBlock, /preferences-loaded/);
  assert.doesNotMatch(readyBlock, /preferences-load-failed/);
});

test('preferences:get refreshes main-local animation speed on demand', () => {
  const main = readSource('src/main/main.ts');
  const handlerStart = main.indexOf("ipcMain.handle('preferences:get'");
  assert.notEqual(handlerStart, -1, 'main.ts should handle preferences:get');
  const handlerEnd = main.indexOf("ipcMain.handle('preload-limit:update'", handlerStart);
  assert.notEqual(handlerEnd, -1, 'preferences:get handler should precede preload-limit handler');
  const handler = main.slice(handlerStart, handlerEnd);

  assert.match(handler, /const prefs\s*=\s*await loadPreferences\(\)/);
  assert.match(handler, /animationSpeedMultiplier\s*=\s*prefs\.animation\.speedMultiplier/);
  assert.match(handler, /return prefs/);
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
