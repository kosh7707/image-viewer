import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';

interface PortableFolderScript {
  PORTABLE_FOLDER_METADATA: {
    portableDirName: string;
    appRelative: string;
    dataDirs: string[];
    launcherName: string;
    sentinelFile: string;
  };
  makePortableFolder(options: { sourceDir: string; outputDir: string }): {
    portableRoot: string;
    appRoot: string;
    dataRoot: string;
  };
}

function loadScript(): PortableFolderScript {
  const requireFromHere = createRequire(__filename);
  return requireFromHere(
    path.join(process.cwd(), 'scripts', 'make-portable-folder.js'),
  ) as PortableFolderScript;
}

test('portable folder script exports stable folder metadata', () => {
  const { PORTABLE_FOLDER_METADATA } = loadScript();

  assert.deepEqual(PORTABLE_FOLDER_METADATA, {
    portableDirName: 'ImageViewerPortable',
    appRelative: path.join('App', 'ImageViewer'),
    dataDirs: ['userData', 'sessionData', 'logs'],
    launcherName: 'ImageViewerPortable.cmd',
    sentinelFile: '.imageviewer-portable-folder',
  });
});

test('portable folder script assembles App and Data folders from an unpacked app source', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-portable-folder-'));
  try {
    const source = path.join(temp, 'win-unpacked');
    fs.mkdirSync(path.join(source, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(source, 'ImageViewer.exe'), 'fake exe');
    fs.writeFileSync(path.join(source, 'resources', 'app.asar'), 'fake asar');

    const outputDir = path.join(temp, 'out');
    const { makePortableFolder } = loadScript();
    const result = makePortableFolder({ sourceDir: source, outputDir });

    assert.equal(result.portableRoot, path.join(outputDir, 'ImageViewerPortable'));
    assert.equal(result.appRoot, path.join(outputDir, 'ImageViewerPortable', 'App', 'ImageViewer'));
    assert.equal(result.dataRoot, path.join(outputDir, 'ImageViewerPortable', 'Data'));
    assert.equal(
      fs.existsSync(path.join(result.appRoot, 'resources', 'app.asar')),
      true,
      'unpacked app files should be copied under App/ImageViewer',
    );
    assert.equal(fs.existsSync(path.join(result.dataRoot, 'userData')), true);
    assert.equal(fs.existsSync(path.join(result.dataRoot, 'sessionData')), true);
    assert.equal(fs.existsSync(path.join(result.dataRoot, 'logs')), true);
    assert.equal(
      fs.existsSync(path.join(result.portableRoot, '.imageviewer-portable-folder')),
      true,
    );

    const readme = fs.readFileSync(path.join(result.portableRoot, 'README-PORTABLE.txt'), 'utf8');
    assert.match(readme, /delete (the )?folder/i);
    assert.match(readme, /no .*Add\/Remove Programs/i);
    assert.match(readme, /file associations are not registered/i);
    assert.match(readme, /registry/i);

    const launcher = fs.readFileSync(
      path.join(result.portableRoot, 'ImageViewerPortable.cmd'),
      'utf8',
    );
    assert.match(launcher, /IMAGEVIEWER_PORTABLE_ROOT/);
    assert.match(launcher, /App\\ImageViewer\\ImageViewer\.exe/);
    assert.match(launcher, /%\*/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable folder script refuses to replace an unmarked existing folder', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-portable-folder-'));
  try {
    const source = path.join(temp, 'win-unpacked');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'ImageViewer.exe'), 'fake exe');

    const outputDir = path.join(temp, 'out');
    const existing = path.join(outputDir, 'ImageViewerPortable');
    fs.mkdirSync(existing, { recursive: true });
    fs.writeFileSync(path.join(existing, 'unrelated.txt'), 'do not delete');

    const { makePortableFolder } = loadScript();
    assert.throws(
      () => makePortableFolder({ sourceDir: source, outputDir }),
      /refusing to replace.*portable marker/i,
    );
    assert.equal(fs.existsSync(path.join(existing, 'unrelated.txt')), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable folder script rejects destructive source/destination relationships', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-portable-folder-'));
  try {
    const outputDir = path.join(temp, 'out');
    const nestedSource = path.join(outputDir, 'ImageViewerPortable', 'App', 'ImageViewer');
    fs.mkdirSync(nestedSource, { recursive: true });

    const { makePortableFolder } = loadScript();
    assert.throws(
      () => makePortableFolder({ sourceDir: nestedSource, outputDir }),
      /source.*destination|destination.*source/i,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable folder script does not invoke packaging commands', () => {
  const source = fs.readFileSync('scripts/make-portable-folder.js', 'utf8');

  assert.doesNotMatch(source, /electron-builder/);
  assert.doesNotMatch(source, /npm\s+run\s+dist/);
  assert.doesNotMatch(source, /npm\s+run\s+build/);
});
