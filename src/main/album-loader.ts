import type { WalkEntry } from './walk';

export type AlbumLoadEntry = WalkEntry;

export interface AlbumLoadDeps {
  walk: (rootDir: string) => WalkEntry[];
}

export interface AlbumLoadResult {
  status: 'ok' | 'empty';
  entries: AlbumLoadEntry[];
}

/**
 * Discover supported image files and return them to the renderer.
 *
 * File decoding and RAM-budgeted cache admission happen later in the renderer,
 * so opening a folder should not read every image before the album appears.
 */
export async function loadAlbum(rootDir: string, deps: AlbumLoadDeps): Promise<AlbumLoadResult> {
  const entries = deps.walk(rootDir);
  if (entries.length === 0) {
    return { status: 'empty', entries: [] };
  }

  return { status: 'ok', entries };
}
