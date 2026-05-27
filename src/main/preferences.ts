import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_USER_PREFERENCES,
  normalizeAnimatedPreloadMemoryLimitBytes,
  normalizeAnimationSpeed,
  normalizePreferences,
  type UserPreferences,
} from '../shared/user-preferences';

const SETTINGS_DIR = 'settings';
const PREFERENCES_FILE = 'preferences.json';

export function preferencesFilePath(userDataDir: string): string {
  return path.join(userDataDir, SETTINGS_DIR, PREFERENCES_FILE);
}

export async function loadPreferences(userDataDir: string): Promise<UserPreferences> {
  try {
    const raw = await fs.promises.readFile(preferencesFilePath(userDataDir), 'utf8');
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return normalizePreferences(DEFAULT_USER_PREFERENCES);
  }
}

export async function savePreferences(
  userDataDir: string,
  preferences: UserPreferences,
): Promise<UserPreferences> {
  const normalized = normalizePreferences(preferences);
  const filePath = preferencesFilePath(userDataDir);
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `${PREFERENCES_FILE}.${process.pid}.tmp`);
  await fs.promises.writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
  await fs.promises.rename(tempPath, filePath);
  return normalized;
}

export async function updateAnimationSpeed(
  userDataDir: string,
  speedMultiplier: number,
): Promise<UserPreferences> {
  const current = await loadPreferences(userDataDir);
  return await savePreferences(userDataDir, {
    ...current,
    animation: {
      ...current.animation,
      speedMultiplier: normalizeAnimationSpeed(speedMultiplier),
    },
  });
}

export async function updateAnimatedPreloadMemoryLimit(
  userDataDir: string,
  memoryLimitBytes: number,
): Promise<UserPreferences> {
  const current = await loadPreferences(userDataDir);
  return await savePreferences(userDataDir, {
    ...current,
    preload: {
      ...current.preload,
      animatedMemoryLimitBytes: normalizeAnimatedPreloadMemoryLimitBytes(memoryLimitBytes),
    },
  });
}
