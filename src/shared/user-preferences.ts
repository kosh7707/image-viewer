export interface UserPreferences {
  animation: {
    speedMultiplier: number;
  };
  preload: {
    /** Legacy key name; now governs the all-image preload RAM budget. */
    animatedMemoryLimitBytes: number;
  };
}

export const DEFAULT_ANIMATION_SPEED = 1.0;
export const MIN_ANIMATION_SPEED = 0.1;
export const MAX_ANIMATION_SPEED = 4.0;
export const MEMORY_GB_BYTES = 1024 * 1024 * 1024;
export const MIN_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES = MEMORY_GB_BYTES * 0.5;
export const MAX_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES = MEMORY_GB_BYTES * 32;
export const DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES = MEMORY_GB_BYTES * 4;

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  animation: {
    speedMultiplier: DEFAULT_ANIMATION_SPEED,
  },
  preload: {
    animatedMemoryLimitBytes: DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES,
  },
};

export function normalizeAnimationSpeed(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ANIMATION_SPEED;
  const snapped = Math.round(value * 10) / 10;
  return Math.max(MIN_ANIMATION_SPEED, Math.min(MAX_ANIMATION_SPEED, snapped));
}

export function gbToMemoryLimitBytes(value: number): number {
  return Math.round(value * MEMORY_GB_BYTES);
}

export function normalizeAnimatedPreloadMemoryLimitBytes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES;
  }
  const snappedGb = Math.round((value / MEMORY_GB_BYTES) * 10) / 10;
  const snappedBytes = gbToMemoryLimitBytes(snappedGb);
  return Math.max(
    MIN_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES,
    Math.min(MAX_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES, snappedBytes),
  );
}

export function formatMemoryLimit(bytes: number): string {
  const safeBytes = typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const gb = Math.round((safeBytes / MEMORY_GB_BYTES) * 10) / 10;
  const text = Number.isInteger(gb) ? String(gb) : gb.toFixed(1);
  return `${text} GB`;
}

export function normalizePreferences(value: unknown): UserPreferences {
  const raw = value as {
    animation?: { speedMultiplier?: unknown };
    preload?: { animatedMemoryLimitBytes?: unknown };
  } | null;
  return {
    animation: {
      speedMultiplier: normalizeAnimationSpeed(raw?.animation?.speedMultiplier),
    },
    preload: {
      animatedMemoryLimitBytes: normalizeAnimatedPreloadMemoryLimitBytes(
        raw?.preload?.animatedMemoryLimitBytes,
      ),
    },
  };
}
