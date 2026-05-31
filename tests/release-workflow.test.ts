import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';

function readText(path: string): string {
  return fs.readFileSync(path, 'utf8');
}

test('package metadata is aligned with v1.0.0 release tag', () => {
  const pkg = JSON.parse(readText('package.json')) as { version: string };
  const lock = JSON.parse(readText('package-lock.json')) as {
    version: string;
    packages: Record<string, { version?: string }>;
  };

  assert.equal(pkg.version, '1.0.0');
  assert.equal(lock.version, '1.0.0');
  assert.equal(lock.packages['']?.version, '1.0.0');
});

test('release workflow publishes folder-portable zip assets, not single exe assets', () => {
  const workflow = readText('.github/workflows/release.yml');

  assert.match(workflow, /Build Windows folder-portable zip and publish Release/);
  assert.match(
    workflow,
    /node scripts\/audit-portable-folder\.js release\/ImageViewerPortable > release\/portable-audit\.json/,
  );
  assert.match(workflow, /Compress-Archive/);
  assert.match(workflow, /ImageViewerPortable-v\$version-win-x64\.zip/);
  assert.match(workflow, /SHA256SUMS\.txt/);
  assert.match(workflow, /portable-audit\.json/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);
  assert.match(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /release\/\*\.exe/);
  assert.doesNotMatch(workflow, /portable \.exe/i);
});

test('ci workflow verifies and uploads the folder-portable artifact', () => {
  const workflow = readText('.github/workflows/ci.yml');

  assert.match(workflow, /Package folder portable/);
  assert.match(workflow, /npm run dist/);
  assert.match(workflow, /npm run portable:audit/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /release\/ImageViewerPortable/);
  assert.doesNotMatch(workflow, /release\/\*\.exe/);
});
