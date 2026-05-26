/**
 * gif-host.ts — drives a parsed GIF (frames + per-frame delays in ms).
 *
 * Uses `requestAnimationFrame` to advance frames based on accumulated
 * `elapsedSinceLastFrame * speedMultiplier`. Speed change takes effect on
 * the next rAF callback; the GIF does not restart.
 */

import { CanvasPainter } from './canvas';

export interface ParsedGif {
  frames: ImageBitmap[];
  /** per-frame delay in milliseconds (already converted from GIF 1/100s units) */
  delays: number[];
}

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 4.0;

export class GifHost {
  private painter: CanvasPainter;
  private gif: ParsedGif | null = null;
  private currentFrameIdx = 0;
  private elapsedSinceLastFrame = 0;
  private lastTimestamp = 0;
  private rafHandle: number | null = null;
  private _speed = 1.0;
  private onSpeedChange?: (speed: number) => void;

  constructor(painter: CanvasPainter, onSpeedChange?: (speed: number) => void) {
    this.painter = painter;
    this.onSpeedChange = onSpeedChange;
  }

  get speedMultiplier(): number {
    return this._speed;
  }

  set speedMultiplier(v: number) {
    this._speed = clamp(v, MIN_SPEED, MAX_SPEED);
    if (this.onSpeedChange) this.onSpeedChange(this._speed);
  }

  /** Adjust by `+/- 0.1`, clamp to [0.1, 4.0]. */
  bumpSpeed(delta: number): number {
    // Avoid float drift by snapping to 0.1 grid.
    const next = Math.round((this._speed + delta) * 10) / 10;
    this.speedMultiplier = next;
    return this._speed;
  }

  /** Reset speed to 1.0× (called between GIFs in v1 spec? — spec says "persists per session"). */
  resetSpeed(): void {
    this.speedMultiplier = 1.0;
  }

  play(gif: ParsedGif): void {
    this.stop();
    this.gif = gif;
    this.currentFrameIdx = 0;
    this.elapsedSinceLastFrame = 0;
    this.lastTimestamp = 0;
    if (gif.frames.length === 0) return;
    // Paint frame 0 immediately.
    this.painter.drawImage(gif.frames[0]!);
    this.rafHandle = requestAnimationFrame((ts) => this.tick(ts));
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.gif = null;
  }

  private tick(ts: number): void {
    if (!this.gif) return;
    if (this.lastTimestamp === 0) {
      this.lastTimestamp = ts;
      this.rafHandle = requestAnimationFrame((t) => this.tick(t));
      return;
    }
    const dtReal = ts - this.lastTimestamp;
    this.lastTimestamp = ts;
    // Apply speed multiplier to virtual elapsed time.
    this.elapsedSinceLastFrame += dtReal * this._speed;
    const delay = this.gif.delays[this.currentFrameIdx] ?? 100;
    if (this.elapsedSinceLastFrame >= delay) {
      // Advance one or more frames if very late (consume budget).
      while (this.gif && this.elapsedSinceLastFrame >= (this.gif.delays[this.currentFrameIdx] ?? 100)) {
        this.elapsedSinceLastFrame -= this.gif.delays[this.currentFrameIdx] ?? 100;
        this.currentFrameIdx = (this.currentFrameIdx + 1) % this.gif.frames.length;
      }
      if (this.gif) {
        this.painter.drawImage(this.gif.frames[this.currentFrameIdx]!);
      }
    }
    this.rafHandle = requestAnimationFrame((t) => this.tick(t));
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
