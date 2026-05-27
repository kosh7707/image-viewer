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

  clear(): void {
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
    this.img.src = url;
    this.img.hidden = false;
    this.img.classList.add('active');
  }
}

export function nativeMimeForPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
