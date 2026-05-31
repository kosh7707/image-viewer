import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  MENU_LABEL,
  buildRegisterOperations,
  buildShellIntegrationCommand,
  buildUnregisterOperations,
  shellIntegrationTargets,
  statusFromTargetStatuses,
  type ShellIntegrationTargetStatus,
} from '../src/main/shell-integration';
import { SUPPORTED_EXTS } from '../src/main/folder';

test('shell integration targets only supported image extensions and folders', () => {
  const targets = shellIntegrationTargets();

  assert.deepEqual(
    targets.filter((target) => target.kind === 'extension').map((target) => target.id),
    [...SUPPORTED_EXTS],
  );
  assert.equal(targets.filter((target) => target.kind === 'folder').length, 1);
  assert.equal(
    targets.some((target) => target.keyPath.includes('SystemFileAssociations\\image')),
    false,
  );
  assert.equal(
    targets.every((target) => target.keyPath.startsWith('HKCU\\Software\\Classes\\')),
    true,
  );
});

test('shell integration registry plan writes per-user verbs without taking defaults', () => {
  const exePath = path.join('C:', 'Tools', 'Image Viewer', 'ImageViewer.exe');
  const operations = buildRegisterOperations(exePath);
  const command = buildShellIntegrationCommand(exePath);

  assert.equal(command, `"${path.resolve(exePath)}" "%1"`);
  assert.equal(
    operations.some((op) => op.args.includes('HKLM')),
    false,
  );
  assert.equal(
    operations.some((op) => op.args.includes('OpenWithProgIds')),
    false,
  );
  assert.equal(
    operations.some((op) => op.args.includes('/ve')),
    true,
  );
  assert.equal(
    operations.some((op) => op.args.includes(MENU_LABEL)),
    true,
  );
  assert.equal(
    operations.some((op) => op.args.includes(command)),
    true,
  );
});

test('shell integration unregister plan removes only ImageViewer verb keys', () => {
  const operations = buildUnregisterOperations();

  assert.equal(operations.length, shellIntegrationTargets().length);
  assert.equal(
    operations.every((op) => op.ignoreFailure === true && op.args[0] === 'delete'),
    true,
  );
  assert.equal(
    operations.every((op) => op.args[1]?.endsWith('\\shell\\ImageViewer.Open')),
    true,
  );
});

test('shell integration status distinguishes registered, missing, and partial states', () => {
  const registered: ShellIntegrationTargetStatus[] = [
    { id: '.jpg', kind: 'extension', registered: true },
    { id: 'folder', kind: 'folder', registered: true },
  ];
  const missing: ShellIntegrationTargetStatus[] = [
    { id: '.jpg', kind: 'extension', registered: false },
    { id: 'folder', kind: 'folder', registered: false },
  ];
  const partial: ShellIntegrationTargetStatus[] = [
    { id: '.jpg', kind: 'extension', registered: true },
    { id: 'folder', kind: 'folder', registered: false },
  ];

  assert.equal(statusFromTargetStatuses(registered), 'registered');
  assert.equal(statusFromTargetStatuses(missing), 'not-registered');
  assert.equal(statusFromTargetStatuses(partial), 'partial');
});
