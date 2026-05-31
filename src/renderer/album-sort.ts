/**
 * Pure sort helper for the album panel.
 *
 * Returns a new array (input is never mutated) and the new index of the
 * caller's `currentPath` so the viewer can keep showing the same image
 * after a re-sort.
 */

export interface AlbumEntry {
  path: string;
  mtimeMs: number;
}

export type SortKey = 'filename' | 'mtime';
export type SortOrder = 'asc' | 'desc';

export interface SortResult {
  entries: AlbumEntry[];
  /** Index of `currentPath` in `entries`; 0 if not found / empty album. */
  currentIndex: number;
}

const NATURAL_FILENAME_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}

function compareFilenamePath(leftPath: string, rightPath: string): number {
  const left = basename(leftPath);
  const right = basename(rightPath);
  const natural = NATURAL_FILENAME_COLLATOR.compare(left, right);
  if (natural !== 0) return natural;
  const exact = left.localeCompare(right, undefined, { sensitivity: 'variant' });
  if (exact !== 0) return exact;
  return leftPath.localeCompare(rightPath, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortAlbum(
  album: readonly AlbumEntry[],
  key: SortKey,
  order: SortOrder,
  currentPath: string,
): SortResult {
  if (album.length === 0) return { entries: [], currentIndex: 0 };

  const sign = order === 'asc' ? 1 : -1;
  const sorted = album.slice().sort((a, b) => {
    if (key === 'filename') {
      return sign * compareFilenamePath(a.path, b.path);
    }
    // mtime
    return sign * (a.mtimeMs - b.mtimeMs);
  });

  let currentIndex = sorted.findIndex((e) => e.path === currentPath);
  if (currentIndex < 0) currentIndex = 0;

  return { entries: sorted, currentIndex };
}
