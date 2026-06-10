import * as fs from 'node:fs';
import * as path from 'node:path';
import { SUPPORTED_EXTS } from './folder';

const SUPPORTED_EXT = new Set<string>(SUPPORTED_EXTS);
const MAX_DEPTH = 4;
const NATURAL_FILENAME_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export interface WalkEntry {
  path: string;
  mtimeMs: number;
  /** Encoded file size from the directory walk stat; no image decoding required. */
  encodedBytes?: number;
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
        const stat = fs.statSync(full);
        out.push({ path: full, mtimeMs: stat.mtimeMs, encodedBytes: stat.size });
      } catch {
        continue;
      }
    }
  }
}

function compareWalkEntryName(a: WalkEntry, b: WalkEntry): number {
  const left = path.basename(a.path);
  const right = path.basename(b.path);
  const natural = NATURAL_FILENAME_COLLATOR.compare(left, right);
  if (natural !== 0) return natural;
  const exact = left.localeCompare(right, undefined, { sensitivity: 'variant' });
  if (exact !== 0) return exact;
  return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' });
}

function compareWalkEntryPath(rootDir: string, a: WalkEntry, b: WalkEntry): number {
  const leftRelative = path.relative(rootDir, a.path);
  const rightRelative = path.relative(rootDir, b.path);
  const directory = compareRelativeDirectory(leftRelative, rightRelative);
  if (directory !== 0) return directory;
  return compareWalkEntryName(a, b);
}

function compareRelativeDirectory(leftRelative: string, rightRelative: string): number {
  const left = path.dirname(leftRelative);
  const right = path.dirname(rightRelative);
  const leftDir = left === '.' ? '' : left;
  const rightDir = right === '.' ? '' : right;
  if (leftDir === rightDir) return 0;

  const leftParts = leftDir.split(/[\\/]+/).filter(Boolean);
  const rightParts = rightDir.split(/[\\/]+/).filter(Boolean);
  const length = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const natural = NATURAL_FILENAME_COLLATOR.compare(leftParts[index]!, rightParts[index]!);
    if (natural !== 0) return natural;
  }
  return leftParts.length - rightParts.length;
}

/**
 * Recursively collect supported image files under `rootDir`, capped at
 * `MAX_DEPTH = 4` levels. Symlinks are skipped (no cycle following).
 * Hidden directories (leading dot) are skipped. Returns entries sorted by
 * relative folder path, then natural filename.
 */
export function walkImages(rootDir: string): WalkEntry[] {
  const resolvedRoot = path.resolve(rootDir);
  const out: WalkEntry[] = [];
  walkInto(resolvedRoot, 1, out);
  out.sort((a, b) => compareWalkEntryPath(resolvedRoot, a, b));
  return out;
}
