import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

interface AuditScript {
  auditPortableFolder(root: string): {
    status: 'ok' | 'fail';
    missing: string[];
    checks: Array<{ name: string; ok: boolean; message?: string }>;
    bootSummary: {
      present: boolean;
      malformedLines: number;
      runs: Array<{ runId: string; events: string[]; elapsedByEvent: Record<string, number> }>;
      latestRun: { runId: string; events: string[]; elapsedByEvent: Record<string, number> } | null;
    };
  };
  summarizeBootLog(
    logPath: string,
  ): AuditScript['auditPortableFolder'] extends (root: string) => infer R
    ? R extends { bootSummary: infer S }
      ? () => S
      : never
    : never;
}

interface PortableFolderScript {
  makePortableFolder(options: { sourceDir: string; outputDir: string }): {
    portableRoot: string;
  };
}

function loadScript(): AuditScript {
  const requireFromHere = createRequire(__filename);
  return requireFromHere(
    path.join(process.cwd(), 'scripts', 'audit-portable-folder.js'),
  ) as AuditScript;
}

function loadMakePortableFolder(): PortableFolderScript['makePortableFolder'] {
  const requireFromHere = createRequire(__filename);
  return (
    requireFromHere(
      path.join(process.cwd(), 'scripts', 'make-portable-folder.js'),
    ) as PortableFolderScript
  ).makePortableFolder;
}

function createFakeUnpackedApp(temp: string): string {
  const source = path.join(temp, 'win-unpacked');
  fs.mkdirSync(path.join(source, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(source, 'ImageViewer.exe'), 'fake exe');
  fs.writeFileSync(path.join(source, 'resources', 'app.asar'), 'fake asar');
  return source;
}

function createPortableFixture(): { temp: string; portableRoot: string } {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-portable-audit-'));
  const source = createFakeUnpackedApp(temp);
  const makePortableFolder = loadMakePortableFolder();
  const { portableRoot } = makePortableFolder({
    sourceDir: source,
    outputDir: path.join(temp, 'out'),
  });
  return { temp, portableRoot };
}

test('portable audit accepts a valid portable folder without creating or deleting files', () => {
  const { temp, portableRoot } = createPortableFixture();
  try {
    const before = fs.readdirSync(portableRoot).sort();
    const { auditPortableFolder } = loadScript();
    const result = auditPortableFolder(portableRoot);
    const after = fs.readdirSync(portableRoot).sort();

    assert.equal(result.status, 'ok');
    assert.deepEqual(result.missing, []);
    assert.deepEqual(after, before);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable audit reports named failures for missing sentinel and app executable', () => {
  const { temp, portableRoot } = createPortableFixture();
  try {
    fs.rmSync(path.join(portableRoot, '.imageviewer-portable-folder'));
    fs.rmSync(path.join(portableRoot, 'App', 'ImageViewer', 'ImageViewer.exe'));

    const { auditPortableFolder } = loadScript();
    const result = auditPortableFolder(portableRoot);

    assert.equal(result.status, 'fail');
    assert.ok(result.missing.includes('sentinel'));
    assert.ok(result.missing.includes('app-executable'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable audit fails specifically when README omits deletion or registry promises', () => {
  const { temp, portableRoot } = createPortableFixture();
  try {
    fs.writeFileSync(path.join(portableRoot, 'README-PORTABLE.txt'), 'ImageViewer Portable\n');

    const { auditPortableFolder } = loadScript();
    const result = auditPortableFolder(portableRoot);

    assert.equal(result.status, 'fail');
    assert.ok(result.missing.includes('readme-delete-folder'));
    assert.ok(result.missing.includes('readme-no-registry'));
    assert.ok(result.missing.includes('readme-no-file-association'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable audit requires README to say registry integration is unnecessary', () => {
  const { temp, portableRoot } = createPortableFixture();
  try {
    fs.writeFileSync(
      path.join(portableRoot, 'README-PORTABLE.txt'),
      [
        'ImageViewer Portable',
        'To uninstall, delete the folder.',
        'The Windows registry might be mentioned here without a no-registry promise.',
        'File associations are not registered by default.',
        '',
      ].join('\n'),
    );

    const { auditPortableFolder } = loadScript();
    const result = auditPortableFolder(portableRoot);

    assert.equal(result.status, 'fail');
    assert.ok(result.missing.includes('readme-no-registry'));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable audit summarizes boot logs by latest valid runId and counts malformed lines', () => {
  const { temp, portableRoot } = createPortableFixture();
  try {
    const logPath = path.join(portableRoot, 'Data', 'logs', 'boot-times.jsonl');
    fs.writeFileSync(
      logPath,
      [
        JSON.stringify({ ts: '2026-05-29T00:00:00.000Z', runId: 'run-a', event: 'main-start' }),
        JSON.stringify({
          ts: '2026-05-29T00:00:01.000Z',
          runId: 'run-a',
          event: 'window-created',
          data: { elapsedMs: 100 },
        }),
        '{bad json',
        JSON.stringify({ ts: '2026-05-29T00:00:02.000Z', event: 'legacy-event' }),
        JSON.stringify({
          ts: '2026-05-29T00:00:03.000Z',
          runId: 'run-b',
          event: 'renderer-ready',
          data: { elapsedMs: 250 },
        }),
      ].join('\n'),
    );

    const { auditPortableFolder } = loadScript();
    const result = auditPortableFolder(portableRoot);

    assert.equal(result.status, 'ok');
    assert.equal(result.bootSummary.present, true);
    assert.equal(result.bootSummary.malformedLines, 1);
    assert.deepEqual(
      result.bootSummary.runs.map((run) => run.runId),
      ['run-a', 'legacy', 'run-b'],
    );
    assert.equal(result.bootSummary.latestRun?.runId, 'run-b');
    assert.deepEqual(result.bootSummary.latestRun?.events, ['renderer-ready']);
    assert.equal(result.bootSummary.latestRun?.elapsedByEvent['renderer-ready'], 250);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable audit treats absent or empty boot logs as non-fatal', () => {
  const { temp, portableRoot } = createPortableFixture();
  try {
    const { auditPortableFolder } = loadScript();
    let result = auditPortableFolder(portableRoot);
    assert.equal(result.status, 'ok');
    assert.equal(result.bootSummary.present, false);

    fs.writeFileSync(path.join(portableRoot, 'Data', 'logs', 'boot-times.jsonl'), '');
    result = auditPortableFolder(portableRoot);
    assert.equal(result.status, 'ok');
    assert.equal(result.bootSummary.present, true);
    assert.deepEqual(result.bootSummary.runs, []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable audit CLI emits deterministic JSON and exit codes', () => {
  const { temp, portableRoot } = createPortableFixture();
  try {
    const scriptPath = path.join(process.cwd(), 'scripts', 'audit-portable-folder.js');
    const ok = spawnSync(process.execPath, [scriptPath, portableRoot], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).status, 'ok');

    fs.rmSync(path.join(portableRoot, '.imageviewer-portable-folder'));
    const fail = spawnSync(process.execPath, [scriptPath, portableRoot], { encoding: 'utf8' });
    assert.notEqual(fail.status, 0);
    assert.equal(JSON.parse(fail.stdout).status, 'fail');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('portable audit script and package hook do not build or package', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  const auditScript = pkg.scripts['portable:audit'];
  assert.equal(auditScript, 'node scripts/audit-portable-folder.js release/ImageViewerPortable');
  assert.doesNotMatch(auditScript, /&&|electron-builder|npm run dist|npm run build/);

  const source = fs.readFileSync('scripts/audit-portable-folder.js', 'utf8');
  assert.doesNotMatch(source, /electron-builder/);
  assert.doesNotMatch(source, /npm\s+run\s+dist/);
  assert.doesNotMatch(source, /npm\s+run\s+build/);
  assert.doesNotMatch(source, /rmSync|cpSync|mkdirSync|writeFileSync/);
});
