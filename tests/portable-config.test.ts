import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyPortableRuntimePaths, resolvePortableLayout } from '../src/main/portable-runtime';

test('portable package shows a splash bitmap during self-extraction', () => {
  const config = fs.readFileSync('electron-builder.yml', 'utf8');
  assert.match(config, /portable:\s*\n(?: {2}.+\n)* {2}splashImage: build\/portable-splash\.bmp/);

  const splash = fs.readFileSync('build/portable-splash.bmp');
  assert.equal(splash.subarray(0, 2).toString('ascii'), 'BM');
  assert.ok(splash.byteLength > 1000, 'splash bitmap should be a real BMP asset');
});

test('folder portable layout is resolved from an explicit environment root', () => {
  const root = path.resolve('tmp-portable-root');
  const layout = resolvePortableLayout({
    env: { IMAGEVIEWER_PORTABLE_ROOT: root },
    execPath: path.resolve('elsewhere', 'ImageViewer.exe'),
  });

  assert.ok(layout);
  assert.equal(layout.portableRoot, root);
  assert.equal(layout.appRoot, path.join(root, 'App', 'ImageViewer'));
  assert.equal(layout.dataRoot, path.join(root, 'Data'));
  assert.equal(layout.userDataDir, path.join(root, 'Data', 'userData'));
  assert.equal(layout.sessionDataDir, path.join(root, 'Data', 'sessionData'));
  assert.equal(layout.logsDir, path.join(root, 'Data', 'logs'));
});

test('folder portable layout is derived from the packaged app executable path', () => {
  const root = path.resolve('ImageViewerPortable');
  const execPath = path.join(root, 'App', 'ImageViewer', 'ImageViewer.exe');
  const layout = resolvePortableLayout({ env: {}, execPath });

  assert.ok(layout);
  assert.equal(layout.portableRoot, root);
  assert.equal(layout.appRoot, path.join(root, 'App', 'ImageViewer'));
  assert.equal(layout.userDataDir, path.join(root, 'Data', 'userData'));
});

test('folder portable layout is not derived from an unexpected executable name', () => {
  const root = path.resolve('ImageViewerPortable');
  const execPath = path.join(root, 'App', 'ImageViewer', 'OtherTool.exe');
  const layout = resolvePortableLayout({ env: {}, execPath });

  assert.equal(layout, null);
});

test('normal development runs do not redirect Electron data paths', () => {
  const layout = resolvePortableLayout({
    env: {},
    execPath: path.resolve('node_modules', 'electron', 'dist', 'electron.exe'),
  });

  assert.equal(layout, null);
});

test('folder portable mode applies userData, sessionData, and logs paths', () => {
  const root = path.resolve('ImageViewerPortable');
  const calls: Array<[string, string]> = [];
  const logs: string[] = [];
  const ensured: string[] = [];

  const applied = applyPortableRuntimePaths({
    env: { IMAGEVIEWER_PORTABLE_ROOT: root },
    execPath: path.resolve('ignored.exe'),
    ensureDir: (value) => ensured.push(value),
    setPath: (name, value) => calls.push([name, value]),
    setAppLogsPath: (value) => logs.push(value),
  });

  assert.ok(applied);
  assert.deepEqual(calls, [
    ['userData', path.join(root, 'Data', 'userData')],
    ['sessionData', path.join(root, 'Data', 'sessionData')],
  ]);
  assert.deepEqual(logs, [path.join(root, 'Data', 'logs')]);
  assert.deepEqual(ensured, [
    path.join(root, 'Data', 'userData'),
    path.join(root, 'Data', 'sessionData'),
    path.join(root, 'Data', 'logs'),
  ]);
});
