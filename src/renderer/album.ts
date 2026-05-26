export interface AlbumState {
  folder: string;
  paths: string[];
  currentIndex: number;
}

export class Album {
  state: AlbumState = { folder: '', paths: [], currentIndex: 0 };

  load(folder: string, paths: string[], currentIndex: number): void {
    this.state.folder = folder;
    this.state.paths = paths.slice();
    this.state.currentIndex = Math.max(0, Math.min(currentIndex, paths.length - 1));
  }

  current(): string | null {
    if (this.state.paths.length === 0) return null;
    return this.state.paths[this.state.currentIndex] ?? null;
  }

  next(): string | null {
    if (this.state.paths.length === 0) return null;
    this.state.currentIndex = (this.state.currentIndex + 1) % this.state.paths.length;
    return this.current();
  }

  prev(): string | null {
    if (this.state.paths.length === 0) return null;
    this.state.currentIndex =
      (this.state.currentIndex - 1 + this.state.paths.length) % this.state.paths.length;
    return this.current();
  }

  pathAt(idx: number): string | null {
    if (this.state.paths.length === 0) return null;
    const len = this.state.paths.length;
    const wrapped = ((idx % len) + len) % len;
    return this.state.paths[wrapped] ?? null;
  }

  size(): number {
    return this.state.paths.length;
  }

  index(): number {
    return this.state.currentIndex;
  }
}
