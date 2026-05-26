import * as fs from 'node:fs';
import * as path from 'node:path';

const SUPPORTED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const MAX_DEPTH = 4;

export interface WalkEntry {
  path: string;
  mtimeMs: number;
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i >= 0 ? p.slice(i).toLowerCase() : '';
}

function walkInto(dir: string, level: number, out: WalkEntry[]): void {
  if (level > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.isSymbolicLink()) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.startsWith('.')) continue;
      walkInto(full, level + 1, out);
    } else if (ent.isFile()) {
      if (!SUPPORTED_EXT.has(extOf(ent.name))) continue;
      try {
        const mtimeMs = fs.statSync(full).mtimeMs;
        out.push({ path: full, mtimeMs });
      } catch {
        continue;
      }
    }
  }
}

/**
 * Recursively collect supported image files under `rootDir`, capped at
 * `MAX_DEPTH = 4` levels. Symlinks are skipped (no cycle following).
 * Hidden directories (leading dot) are skipped. Returns entries sorted
 * by basename ascending (locale-aware).
 */
export function walkImages(rootDir: string): WalkEntry[] {
  const out: WalkEntry[] = [];
  walkInto(rootDir, 1, out);
  out.sort((a, b) => path.basename(a.path).localeCompare(path.basename(b.path)));
  return out;
}
