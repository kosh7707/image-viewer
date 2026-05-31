import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { applyPortableRuntimePaths, resolvePortableLayout } from '../src/main/portable-runtime';

function readPackageJson(): { scripts: Record<string, string> } {
  return JSON.parse(fs.readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };
}

function readBuilderConfig(): string {
  return fs.readFileSync('electron-builder.yml', 'utf8');
}

function escapedPattern(pattern: string): RegExp {
  return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

test('dist script describes the future folder-portable pipeline', () => {
  const pkg = readPackageJson();

  assert.match(pkg.scripts.dist, /electron-builder --dir/);
  assert.match(pkg.scripts.dist, /npm run portable:folder/);
  assert.match(pkg.scripts['portable:folder'], /scripts\/make-portable-folder\.js/);
  assert.match(pkg.scripts['portable:folder'], /release\/win-unpacked/);
  assert.match(pkg.scripts['portable:folder'], /release/);
  assert.doesNotMatch(
    pkg.scripts['portable:folder'],
    /electron-builder|npm run dist|npm run build/,
  );
});

test('builder config targets folder-portable assembly instead of single-exe portable', () => {
  const config = readBuilderConfig();

  assert.doesNotMatch(config, /^\s*portable:\s*$/m);
  assert.doesNotMatch(config, /target:\s*portable/);
  assert.doesNotMatch(config, /portable-splash/);
  assert.doesNotMatch(config, /^\s*fileAssociations:\s*$/m);
});

test('builder config keeps only the locales needed by the portable app', () => {
  const config = readBuilderConfig();

  assert.match(config, /^\s*electronLanguages:\s*$/m);
  assert.match(config, /^\s*-\s*en-US\s*$/m);
  assert.match(config, /^\s*-\s*ko\s*$/m);
});

test('builder config uses narrow payload trim rules', () => {
  const config = readBuilderConfig();
  const expectedExcludes = [
    "'!dist/tests/**'",
    "'!**/*.map'",
    "'!**/*.ts'",
    "'!node_modules/gifuct-js/demo/**'",
  ];

  for (const pattern of expectedExcludes) {
    assert.match(config, escapedPattern(pattern));
  }

  assert.doesNotMatch(config, /!node_modules\/\*\*\/tests?/);
  assert.doesNotMatch(config, /!node_modules\/\*\*\/docs?/);
  assert.doesNotMatch(config, /!node_modules\/\*\*\/examples?/);
});

test('legacy single-exe portable splash asset is no longer part of builder config', () => {
  const config = readBuilderConfig();
  assert.doesNotMatch(config, /splashImage:\s*build\/portable-splash\.bmp/);

  // Keep the asset for now so the branch stays reversible while the new
  // folder-portable path stabilizes.
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
  const source = fs.readFileSync('src/main/portable-runtime.ts', 'utf8');
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
  ]);
  assert.doesNotMatch(source, /ensureDir\(layout\.logsDir\)/);
});
