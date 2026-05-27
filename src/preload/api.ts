/**
 * Shared types for the preload/renderer API surface.
 * The preload script uses contextBridge to expose `window.api` matching this shape.
 */

import type { UserPreferences } from '../shared/user-preferences';

export interface AlbumEntryDTO {
  path: string;
  mtimeMs: number;
  /** Header-derived width, when the album was loaded by the main process. */
  width?: number;
  /** Header-derived height, when the album was loaded by the main process. */
  height?: number;
  /** Header-derived frame count; static images are 1, animated images are >1. */
  frameCount?: number;
  /** Static preload/cache memory estimate in bytes. Animated media is usually 0. */
  estimatedBytes?: number;
  /** Encoded file size in bytes. */
  encodedBytes?: number;
  /** RGBA bytes if all frames are decoded into full-canvas bitmaps. */
  allFramesDecodedBytes?: number;
  /** Approximate native/streaming playback working set in bytes. */
  playbackBytes?: number;
}

export interface AlbumLoadPayload {
  folder: string;
  entries: AlbumEntryDTO[];
  currentIndex: number;
}

export interface RssUpdatePayload {
  bytes: number;
}

export type AlbumProgressPhase = 'scanning' | 'measuring' | 'preloading';

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
  /** Load persisted user preferences from Electron userData. */
  getPreferences(): Promise<UserPreferences>;
  /** Persist the animated preload memory limit. */
  updateAnimatedPreloadMemoryLimit(bytes: number): Promise<UserPreferences>;
  /** Read an image file as bytes (validated by main). */
  readFile(filePath: string): Promise<Uint8Array>;
  /** Return a validated file:// URL for native browser image playback. */
  fileUrl(filePath: string): Promise<string>;
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
  /** Subscribe to menu:settings-request events. */
  onSettingsRequest(cb: () => void): () => void;
}

declare global {
  interface Window {
    api: ImageViewerApi;
  }
}
