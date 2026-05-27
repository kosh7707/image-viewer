/**
 * NativeImageHost drives the overlay `<img>` used for browser-native animated
 * formats/fallbacks. It intentionally owns object-URL lifetime so switching
 * between images cannot leak the previous Blob URL.
 */

export interface ObjectUrlAdapter {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

const DEFAULT_URLS: ObjectUrlAdapter = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
};

export class NativeImageHost {
  private img: HTMLImageElement;
  private urls: ObjectUrlAdapter;
  private currentObjectUrl: string | null = null;
  private loadToken = 0;

  constructor(img: HTMLImageElement, urls: ObjectUrlAdapter = DEFAULT_URLS) {
    this.img = img;
    this.urls = urls;
  }

  showBytes(bytes: Uint8Array, mime: string): void {
    this.clear();
    const cleanBuf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([cleanBuf], { type: mime });
    const url = this.urls.createObjectURL(blob);
    this.currentObjectUrl = url;
    this.showSource(url);
  }

  showUrl(url: string): void {
    this.clear();
    this.showSource(url);
  }

  /**
   * Start loading a validated file URL without activating the overlay until
   * Chromium has read enough image data to report dimensions. Activating the
   * `<img>` before that point covers the current canvas with a black fallback
   * box, which is indistinguishable from "the GIF did not open" on large files.
   */
  async showUrlWhenReady(url: string): Promise<boolean> {
    const token = this.beginHiddenLoad();
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      let pollTimer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = (): void => {
        if (pollTimer !== null) {
          clearTimeout(pollTimer);
          pollTimer = null;
        }
        this.img.removeEventListener('load', onLoad);
        this.img.removeEventListener('error', onError);
      };
      const finish = (loaded: boolean): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (this.loadToken !== token) {
          resolve(false);
          return;
        }
        if (loaded && this.hasImageDimensions()) {
          this.activateLoadedSource();
          resolve(true);
          return;
        }
        this.clear();
        resolve(false);
      };
      const checkReady = (): void => {
        if (this.loadToken !== token) {
          finish(false);
          return;
        }
        if (this.hasImageDimensions()) {
          finish(true);
          return;
        }
        pollTimer = setTimeout(checkReady, 50);
      };
      const onLoad = (): void => finish(true);
      const onError = (): void => finish(false);

      this.img.addEventListener('load', onLoad, { once: true });
      this.img.addEventListener('error', onError, { once: true });
      this.img.src = url;
      checkReady();
    });
  }

  clear(): void {
    this.loadToken += 1;
    if (this.currentObjectUrl) {
      this.urls.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
      this.img.removeAttribute('src');
    } else if (this.img.src) {
      this.img.removeAttribute('src');
    }
    this.img.classList.remove('active');
    this.img.hidden = true;
  }

  private showSource(url: string): void {
    this.loadToken += 1;
    this.img.src = url;
    this.activateLoadedSource();
  }

  private beginHiddenLoad(): number {
    this.clear();
    const token = ++this.loadToken;
    this.img.hidden = true;
    this.img.classList.remove('active');
    return token;
  }

  private activateLoadedSource(): void {
    this.img.hidden = false;
    this.img.classList.add('active');
  }

  private hasImageDimensions(): boolean {
    return this.img.naturalWidth > 0;
  }
}

export function nativeMimeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
