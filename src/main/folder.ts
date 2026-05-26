import * as fs from 'fs';
import * as path from 'path';

export const SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'] as const;

export function isSupportedImage(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return (SUPPORTED_EXTS as readonly string[]).includes(ext);
}

/**
 * Read a directory, filter to supported image extensions (case-insensitive),
 * sort alphabetically (locale-aware), and return absolute paths.
 */
export function listImages(dir: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    return [];
  }
  const filtered = entries.filter((name) => {
    try {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (!st.isFile()) return false;
    } catch {
      return false;
    }
    return isSupportedImage(name);
  });
  filtered.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  return filtered.map((name) => path.join(dir, name));
}

/**
 * Resolve a path that came from argv to (folder, currentIndex).
 * If path is a file, returns its parent folder and the index of the file.
 * If path is a directory, returns the directory and index 0.
 */
export function resolveArg(argPath: string): { folder: string; currentIndex: number; images: string[] } | null {
  let abs: string;
  try {
    abs = path.resolve(argPath);
    const st = fs.statSync(abs);
    if (st.isFile()) {
      const folder = path.dirname(abs);
      const images = listImages(folder);
      const idx = images.findIndex((p) => path.resolve(p) === abs);
      return { folder, currentIndex: idx >= 0 ? idx : 0, images };
    } else if (st.isDirectory()) {
      const images = listImages(abs);
      return { folder: abs, currentIndex: 0, images };
    }
  } catch {
    return null;
  }
  return null;
}
