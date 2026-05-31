#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { PORTABLE_FOLDER_METADATA } = require('./make-portable-folder.js');

function check(name, ok, message) {
  return ok ? { name, ok: true } : { name, ok: false, message };
}

function readTextIfExists(filePath) {
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function parseRecord(line) {
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.event !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function explainsNoRegistryIntegration(readme) {
  return (
    /no registry integration/i.test(readme) || /registry integration is not required/i.test(readme)
  );
}

function summarizeBootLog(logPath) {
  const summary = {
    present: fs.existsSync(logPath),
    malformedLines: 0,
    runs: [],
    latestRun: null,
  };
  if (!summary.present) return summary;

  const raw = readTextIfExists(logPath);
  if (raw.trim().length === 0) return summary;

  const runMap = new Map();
  let latestRunId = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim().length === 0) continue;
    const record = parseRecord(line);
    if (!record) {
      summary.malformedLines++;
      continue;
    }
    const runId =
      typeof record.runId === 'string' && record.runId.length > 0 ? record.runId : 'legacy';
    latestRunId = runId;
    let run = runMap.get(runId);
    if (!run) {
      run = { runId, events: [], elapsedByEvent: {} };
      runMap.set(runId, run);
    }
    run.events.push(record.event);
    const elapsedMs = record.data && record.data.elapsedMs;
    if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs)) {
      run.elapsedByEvent[record.event] = elapsedMs;
    }
  }

  summary.runs = Array.from(runMap.values());
  summary.latestRun = latestRunId ? (runMap.get(latestRunId) ?? null) : null;
  return summary;
}

function auditPortableFolder(root) {
  const portableRoot = path.resolve(root);
  const appRoot = path.join(portableRoot, PORTABLE_FOLDER_METADATA.appRelative);
  const dataRoot = path.join(portableRoot, 'Data');
  const readmePath = path.join(portableRoot, 'README-PORTABLE.txt');
  const launcherPath = path.join(portableRoot, PORTABLE_FOLDER_METADATA.launcherName);
  const readme = readTextIfExists(readmePath);
  const launcher = readTextIfExists(launcherPath);

  const portableRootExists = fs.existsSync(portableRoot);
  const checks = [
    check(
      'portable-root',
      portableRootExists && fs.statSync(portableRoot).isDirectory(),
      'portable folder is missing',
    ),
    check(
      'sentinel',
      fs.existsSync(path.join(portableRoot, PORTABLE_FOLDER_METADATA.sentinelFile)),
      'portable sentinel is missing',
    ),
    check('launcher', fs.existsSync(launcherPath), 'launcher is missing'),
    check(
      'launcher-portable-root',
      /IMAGEVIEWER_PORTABLE_ROOT/.test(launcher),
      'launcher does not set IMAGEVIEWER_PORTABLE_ROOT',
    ),
    check(
      'launcher-app-target',
      /App\\ImageViewer\\ImageViewer\.exe/.test(launcher),
      'launcher does not target App\\ImageViewer\\ImageViewer.exe',
    ),
    check(
      'app-executable',
      fs.existsSync(path.join(appRoot, 'ImageViewer.exe')),
      'app executable is missing',
    ),
    check(
      'data-userData',
      fs.existsSync(path.join(dataRoot, 'userData')),
      'Data/userData is missing',
    ),
    check(
      'data-sessionData',
      fs.existsSync(path.join(dataRoot, 'sessionData')),
      'Data/sessionData is missing',
    ),
    check('data-logs', fs.existsSync(path.join(dataRoot, 'logs')), 'Data/logs is missing'),
    check('readme', fs.existsSync(readmePath), 'README-PORTABLE.txt is missing'),
    check(
      'readme-delete-folder',
      /delete (the )?folder/i.test(readme),
      'README does not explain folder deletion',
    ),
    check(
      'readme-no-registry',
      explainsNoRegistryIntegration(readme),
      'README does not explain that registry integration is unnecessary',
    ),
    check(
      'readme-no-file-association',
      /file associations? (are )?not registered/i.test(readme),
      'README does not explain file associations are not registered',
    ),
  ];

  const missing = checks.filter((c) => !c.ok).map((c) => c.name);
  return {
    status: missing.length === 0 ? 'ok' : 'fail',
    portableRoot,
    checks,
    missing,
    bootSummary: summarizeBootLog(path.join(dataRoot, 'logs', 'boot-times.jsonl')),
  };
}

function runCli(argv) {
  const target = argv[2];
  if (!target) {
    console.error('usage: node scripts/audit-portable-folder.js <ImageViewerPortable>');
    return 2;
  }
  const result = auditPortableFolder(target);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'ok' ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = runCli(process.argv);
}

module.exports = {
  auditPortableFolder,
  summarizeBootLog,
};
