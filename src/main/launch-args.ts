import * as fs from 'fs';
import * as path from 'path';

const LAUNCH_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.eps']);

export function collectLaunchPaths(
  argv: readonly string[],
  statPath: (candidate: string) => fs.Stats | null = statExistingPath,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const arg of argv.slice(1)) {
    if (!arg || arg === '.' || arg === '--' || arg.startsWith('--')) continue;

    const stat = statPath(arg);
    if (!stat) continue;
    if (!stat.isDirectory() && !isSupportedImagePath(arg)) continue;

    const resolved = path.resolve(arg);
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(resolved);
  }

  return paths;
}

function statExistingPath(candidate: string): fs.Stats | null {
  try {
    return fs.statSync(candidate);
  } catch {
    return null;
  }
}

function isSupportedImagePath(filePath: string): boolean {
  return LAUNCH_IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}
