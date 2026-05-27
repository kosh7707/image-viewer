import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { memoryLimitPresetOptions, settingsSummaryText } from '../src/renderer/settings-dialog';
import { gbToMemoryLimitBytes } from '../src/shared/user-preferences';

test('settings dialog memory labels are human-readable GB values, never raw bytes', () => {
  const options = memoryLimitPresetOptions();
  const labels = options.map((option) => option.label);

  assert.deepEqual(labels, ['1 GB', '2 GB', '4 GB Recommended', '8 GB', 'Custom']);
  assert.equal(
    labels.some((label) => label.includes('4294967296')),
    false,
  );
});

test('settings summary communicates rolling preload with GB labels', () => {
  const summary = settingsSummaryText({
    estimatedBytes: gbToMemoryLimitBytes(11.4),
    limitBytes: gbToMemoryLimitBytes(4),
  });

  assert.match(summary, /11\.4 GB/);
  assert.match(summary, /4 GB/);
  assert.match(summary, /Rolling preload/);
  assert.equal(summary.includes('4294967296'), false);
});
