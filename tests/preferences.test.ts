import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadPreferences,
  preferencesFilePath,
  savePreferences,
  updateAnimationSpeed,
} from '../src/main/preferences';
import {
  DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES,
  DEFAULT_ANIMATION_SPEED,
  MAX_ANIMATION_SPEED,
  MIN_ANIMATION_SPEED,
  formatMemoryLimit,
  gbToMemoryLimitBytes,
  normalizeAnimatedPreloadMemoryLimitBytes,
  normalizeAnimationSpeed,
  normalizePreferences,
} from '../src/shared/user-preferences';

test('preferencesFilePath stores settings under userData/settings/preferences.json', () => {
  assert.equal(
    preferencesFilePath(path.join('C:', 'Users', 'me', 'AppData', 'Roaming', 'ImageViewer')),
    path.join(
      'C:',
      'Users',
      'me',
      'AppData',
      'Roaming',
      'ImageViewer',
      'settings',
      'preferences.json',
    ),
  );
});

test('loadPreferences returns defaults when the file is missing or invalid', async () => {
  const dir = makeTempDir();
  try {
    assert.deepEqual(await loadPreferences(dir), {
      animation: { speedMultiplier: DEFAULT_ANIMATION_SPEED },
      preload: { animatedMemoryLimitBytes: DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES },
    });
    await fs.promises.mkdir(path.dirname(preferencesFilePath(dir)), { recursive: true });
    await fs.promises.writeFile(preferencesFilePath(dir), '{not json', 'utf8');
    assert.deepEqual(await loadPreferences(dir), {
      animation: { speedMultiplier: DEFAULT_ANIMATION_SPEED },
      preload: { animatedMemoryLimitBytes: DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES },
    });
  } finally {
    removeDir(dir);
  }
});

test('savePreferences writes normalized JSON and updateAnimationSpeed mutates only animation speed', async () => {
  const dir = makeTempDir();
  try {
    const saved = await savePreferences(dir, {
      animation: { speedMultiplier: 1.26 },
      preload: { animatedMemoryLimitBytes: gbToMemoryLimitBytes(2) },
    });
    assert.equal(saved.animation.speedMultiplier, 1.3);
    assert.equal(saved.preload.animatedMemoryLimitBytes, gbToMemoryLimitBytes(2));
    assert.equal(
      JSON.parse(await fs.promises.readFile(preferencesFilePath(dir), 'utf8')).animation
        .speedMultiplier,
      1.3,
    );

    const updated = await updateAnimationSpeed(dir, 99);
    assert.equal(updated.animation.speedMultiplier, MAX_ANIMATION_SPEED);
    assert.equal(updated.preload.animatedMemoryLimitBytes, gbToMemoryLimitBytes(2));
    assert.equal((await loadPreferences(dir)).animation.speedMultiplier, MAX_ANIMATION_SPEED);
  } finally {
    removeDir(dir);
  }
});

test('normalizeAnimationSpeed clamps and snaps user-facing animation speeds', () => {
  assert.equal(normalizeAnimationSpeed(Number.NaN), DEFAULT_ANIMATION_SPEED);
  assert.equal(normalizeAnimationSpeed(0), MIN_ANIMATION_SPEED);
  assert.equal(normalizeAnimationSpeed(4.8), MAX_ANIMATION_SPEED);
  assert.equal(normalizeAnimationSpeed(1.24), 1.2);
  assert.equal(normalizeAnimationSpeed(1.25), 1.3);
});

test('normalizePreferences ignores unknown or unsafe preference payloads', () => {
  assert.deepEqual(normalizePreferences({ animation: { speedMultiplier: 'fast' } }), {
    animation: { speedMultiplier: DEFAULT_ANIMATION_SPEED },
    preload: { animatedMemoryLimitBytes: DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES },
  });
  assert.deepEqual(
    normalizePreferences({
      animation: { speedMultiplier: 2.22 },
      preload: { animatedMemoryLimitBytes: gbToMemoryLimitBytes(8) },
      other: true,
    }),
    {
      animation: { speedMultiplier: 2.2 },
      preload: { animatedMemoryLimitBytes: gbToMemoryLimitBytes(8) },
    },
  );
});

test('preload memory limit uses human GB values while storing bytes internally', () => {
  assert.equal(DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES, gbToMemoryLimitBytes(4));
  assert.equal(formatMemoryLimit(DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES), '4 GB');
  assert.equal(formatMemoryLimit(gbToMemoryLimitBytes(1.5)), '1.5 GB');
  assert.equal(formatMemoryLimit(gbToMemoryLimitBytes(114)), '114 GB');
  assert.equal(normalizeAnimatedPreloadMemoryLimitBytes('nope'), gbToMemoryLimitBytes(4));
  assert.equal(
    normalizeAnimatedPreloadMemoryLimitBytes(gbToMemoryLimitBytes(0.25)),
    gbToMemoryLimitBytes(0.5),
  );
  assert.equal(
    normalizeAnimatedPreloadMemoryLimitBytes(gbToMemoryLimitBytes(99)),
    gbToMemoryLimitBytes(32),
  );
});

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'image-viewer-preferences-'));
}

function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
