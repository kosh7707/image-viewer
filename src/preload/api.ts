/**
 * Shared types for the preload/renderer API surface.
 * The preload script uses contextBridge to expose `window.api` matching this shape.
 */

export interface AlbumLoadPayload {
  folder: string;
  images: string[];
  currentIndex: number;
}

export interface RssUpdatePayload {
  bytes: number;
}

export interface ImageViewerApi {
  /** Toggle fullscreen via main process. Returns new fullscreen state. */
  toggleFullscreen(): Promise<boolean>;
  /** Request main process to pop up the right-click context menu. */
  showContextMenu(): Promise<void>;
  /** Notify main of current GIF speed (for the menu label). */
  updateSpeed(speed: number): Promise<void>;
  /** Read an image file as bytes (validated by main). */
  readFile(filePath: string): Promise<Uint8Array>;
  /** Native file-open dialog filtered to supported extensions. */
  openFileDialog(): Promise<AlbumLoadPayload | null>;
  /** Native folder-open dialog. */
  openFolderDialog(): Promise<AlbumLoadPayload | null>;
  /** Subscribe to album:load events from the main process. */
  onAlbumLoad(cb: (payload: AlbumLoadPayload) => void): () => void;
  /** Subscribe to rss:update events. */
  onRssUpdate(cb: (payload: RssUpdatePayload) => void): () => void;
}

declare global {
  interface Window {
    api: ImageViewerApi;
  }
}
