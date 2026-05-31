#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const PORTABLE_DIR_NAME = 'ImageViewerPortable';
const APP_RELATIVE = path.join('App', 'ImageViewer');
const DATA_DIRS = ['userData', 'sessionData', 'logs'];
const SENTINEL_FILE = '.imageviewer-portable-folder';
const LAUNCHER_NAME = 'ImageViewerPortable.cmd';
const PORTABLE_FOLDER_METADATA = {
  portableDirName: PORTABLE_DIR_NAME,
  appRelative: APP_RELATIVE,
  dataDirs: DATA_DIRS,
  launcherName: LAUNCHER_NAME,
  sentinelFile: SENTINEL_FILE,
};

function resolveInside(base, ...parts) {
  return path.resolve(base, ...parts);
}

function isSameOrInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertSafeRelationship(sourceDir, portableRoot) {
  const source = path.resolve(sourceDir);
  const target = path.resolve(portableRoot);
  if (isSameOrInside(source, target) || isSameOrInside(target, source)) {
    throw new Error('source and destination must not contain each other');
  }
}

function assertReplaceablePortableRoot(portableRoot) {
  if (!fs.existsSync(portableRoot)) return;
  const sentinel = path.join(portableRoot, SENTINEL_FILE);
  if (!fs.existsSync(sentinel)) {
    throw new Error('refusing to replace existing folder without portable marker');
  }
}

function writeReadme(portableRoot) {
  const content = [
    'ImageViewer Portable',
    '',
    'Run ImageViewerPortable.cmd or App/ImageViewer/ImageViewer.exe from this folder.',
    '',
    'To uninstall, delete the folder.',
    'This portable package creates no Add/Remove Programs entry.',
    'File associations are not registered by default; no registry integration is required.',
    'Optional Windows integration can add an ImageViewer right-click menu for supported images and folders.',
    'If you enable Windows integration in Settings, use Settings > Windows integration > Remove before deleting or moving this folder.',
    'User data, session data, and logs live under Data/.',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(portableRoot, 'README-PORTABLE.txt'), content, 'utf8');
}

function writeCommandLauncher(portableRoot) {
  const content = [
    '@echo off',
    'set "IMAGEVIEWER_PORTABLE_ROOT=%~dp0"',
    'start "" "%~dp0App\\ImageViewer\\ImageViewer.exe" %*',
    '',
  ].join('\r\n');
  fs.writeFileSync(path.join(portableRoot, LAUNCHER_NAME), content, 'utf8');
}

function makePortableFolder(options) {
  if (!options || !options.sourceDir || !options.outputDir) {
    throw new Error('sourceDir and outputDir are required');
  }

  const sourceDir = path.resolve(options.sourceDir);
  const outputDir = path.resolve(options.outputDir);
  const portableRoot = resolveInside(outputDir, PORTABLE_DIR_NAME);
  const appRoot = resolveInside(portableRoot, APP_RELATIVE);
  const dataRoot = resolveInside(portableRoot, 'Data');

  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`sourceDir must be an existing directory: ${sourceDir}`);
  }
  assertSafeRelationship(sourceDir, portableRoot);
  assertReplaceablePortableRoot(portableRoot);

  fs.rmSync(portableRoot, { recursive: true, force: true });
  fs.mkdirSync(appRoot, { recursive: true });
  fs.cpSync(sourceDir, appRoot, { recursive: true });

  for (const name of DATA_DIRS) {
    fs.mkdirSync(path.join(dataRoot, name), { recursive: true });
  }
  writeReadme(portableRoot);
  writeCommandLauncher(portableRoot);
  fs.writeFileSync(path.join(portableRoot, SENTINEL_FILE), 'ImageViewer portable folder\n', 'utf8');

  return { portableRoot, appRoot, dataRoot };
}

function runCli(argv) {
  const sourceDir = argv[2] || path.resolve('release', 'win-unpacked');
  const outputDir = argv[3] || path.resolve('release');
  const result = makePortableFolder({ sourceDir, outputDir });
  console.log(`Portable folder created: ${result.portableRoot}`);
}

if (require.main === module) {
  runCli(process.argv);
}

module.exports = {
  PORTABLE_FOLDER_METADATA,
  makePortableFolder,
};
