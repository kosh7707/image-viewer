import type { AlbumEntryDTO } from '../preload/api';

export interface AlbumState {
  folder: string;
  entries: AlbumEntryDTO[];
  currentIndex: number;
}

export class Album {
  state: AlbumState = { folder: '', entries: [], currentIndex: 0 };

  load(folder: string, entries: AlbumEntryDTO[], currentIndex: number): void {
    this.state.folder = folder;
    this.state.entries = entries.slice();
    this.state.currentIndex = Math.max(0, Math.min(currentIndex, entries.length - 1));
  }

  /** Replace entries (e.g., after a sort) and reindex to the path that was current. */
  reorder(entries: AlbumEntryDTO[], newCurrentIndex: number): void {
    this.state.entries = entries.slice();
    this.state.currentIndex = Math.max(0, Math.min(newCurrentIndex, entries.length - 1));
  }

  current(): string | null {
    return this.currentEntry()?.path ?? null;
  }

  currentEntry(): AlbumEntryDTO | null {
    if (this.state.entries.length === 0) return null;
    return this.state.entries[this.state.currentIndex] ?? null;
  }

  next(): string | null {
    if (this.state.entries.length === 0) return null;
    this.state.currentIndex = (this.state.currentIndex + 1) % this.state.entries.length;
    return this.current();
  }

  prev(): string | null {
    if (this.state.entries.length === 0) return null;
    this.state.currentIndex =
      (this.state.currentIndex - 1 + this.state.entries.length) % this.state.entries.length;
    return this.current();
  }

  pathAt(idx: number): string | null {
    if (this.state.entries.length === 0) return null;
    const len = this.state.entries.length;
    const wrapped = ((idx % len) + len) % len;
    return this.state.entries[wrapped]?.path ?? null;
  }

  size(): number {
    return this.state.entries.length;
  }

  index(): number {
    return this.state.currentIndex;
  }

  /** Snapshot of current paths in order (legacy convenience for preload-queue). */
  paths(): string[] {
    return this.state.entries.map((e) => e.path);
  }

  /** Snapshot of full entries (path + mtime), for sort dialog. */
  entries(): AlbumEntryDTO[] {
    return this.state.entries.slice();
  }
}
