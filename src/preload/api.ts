/**
 * Shared types for the preload/renderer API surface.
 * The preload script uses contextBridge to expose `window.api` matching this shape.
 */

export interface AlbumEntryDTO {
  path: string;
  mtimeMs: number;
}

export interface AlbumLoadPayload {
  folder: string;
  entries: AlbumEntryDTO[];
  currentIndex: number;
}

export interface RssUpdatePayload {
  bytes: number;
}

export type AlbumProgressPhase = 'measuring' | 'preloading';

export interface AlbumProgressPayload {
  phase: AlbumProgressPhase;
  completed: number;
  total: number;
  bytesSoFar: number;
}

export interface ImageViewerApi {
  /** Toggle fullscreen via main process. Returns new fullscreen state. */
  toggleFullscreen(): Promise<boolean>;
  /** Request main process to pop up the right-click context menu. */
  showContextMenu(point?: { x: number; y: number }): Promise<void>;
  /** Notify main of current GIF speed (for the menu label). */
  updateSpeed(speed: number): Promise<void>;
  /** Read an image file as bytes (validated by main). */
  readFile(filePath: string): Promise<Uint8Array>;
  /** Native file-open dialog filtered to supported extensions. */
  openFileDialog(): Promise<void>;
  /** Native folder-open dialog. */
  openFolderDialog(): Promise<void>;
  /** Quit the app immediately via main process. */
  quitApp(): Promise<void>;
  /** Subscribe to album:load events from the main process. */
  onAlbumLoad(cb: (payload: AlbumLoadPayload) => void): () => void;
  /** Subscribe to rss:update events. */
  onRssUpdate(cb: (payload: RssUpdatePayload) => void): () => void;
  /** Subscribe to album:progress events (measure/preload phases). */
  onAlbumProgress(cb: (payload: AlbumProgressPayload) => void): () => void;
  /** Subscribe to menu:sort-request events (user clicked Sort... in menu). */
  onSortRequest(cb: () => void): () => void;
}

declare global {
  interface Window {
    api: ImageViewerApi;
  }
}
