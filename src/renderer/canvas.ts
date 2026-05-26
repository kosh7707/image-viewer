/**
 * Off-the-shelf canvas painter:
 * - Fills the viewport.
 * - Black background.
 * - Letterboxed `drawImage` of an `ImageBitmap` (or `ImageBitmap`-like with width/height + canvas-drawable).
 */

export interface DrawableSource {
  width: number;
  height: number;
}

export class CanvasPainter {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Failed to acquire 2d context');
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  clear(): void {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Letterbox `bitmap` into the canvas. Maintains aspect ratio.
   */
  drawImage(bitmap: ImageBitmap | HTMLImageElement | HTMLCanvasElement): void {
    this.clear();
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const bw = (bitmap as DrawableSource).width;
    const bh = (bitmap as DrawableSource).height;
    if (bw <= 0 || bh <= 0) return;
    const scale = Math.min(cw / bw, ch / bh);
    const dw = bw * scale;
    const dh = bh * scale;
    const dx = (cw - dw) / 2;
    const dy = (ch - dh) / 2;
    this.ctx.drawImage(bitmap as CanvasImageSource, dx, dy, dw, dh);
  }

  width(): number {
    return this.canvas.width;
  }

  height(): number {
    return this.canvas.height;
  }
}
