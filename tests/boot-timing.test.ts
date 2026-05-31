import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createBootTimingLogger } from '../src/main/boot-timing';

test('boot timing logger writes bounded JSONL records under the supplied logs directory', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-boot-timing-'));
  try {
    const logger = createBootTimingLogger(temp, {
      fileName: 'boot-times.jsonl',
      maxRecords: 2,
      now: () => '2026-05-29T00:00:00.000Z',
    });

    logger.log('main-start');
    logger.log('app-ready', { elapsedMs: 12 });
    logger.log('window-created', { elapsedMs: 34 });

    const logPath = path.join(temp, 'boot-times.jsonl');
    const records = fs
      .readFileSync(logPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string; data?: { elapsedMs?: number } });

    assert.deepEqual(
      records.map((r) => r.event),
      ['app-ready', 'window-created'],
    );
    assert.equal(records[1]!.data?.elapsedMs, 34);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('boot timing logger stamps every record from one process with a stable runId', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-boot-timing-'));
  try {
    const logger = createBootTimingLogger(temp, {
      fileName: 'boot-times.jsonl',
      maxRecords: 10,
      now: () => '2026-05-29T00:00:00.000Z',
      runId: 'test-run',
    });

    logger.log('main-start');
    logger.log('renderer-ready');

    const records = fs
      .readFileSync(path.join(temp, 'boot-times.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { runId?: string });

    assert.deepEqual(
      records.map((r) => r.runId),
      ['test-run', 'test-run'],
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
