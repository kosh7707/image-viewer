export interface SpeedHudTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SpeedHudOptions {
  hideAfterMs?: number;
  timers?: SpeedHudTimers;
}

const DEFAULT_HIDE_AFTER_MS = 900;

export class SpeedHud {
  private host: HTMLElement;
  private node: HTMLDivElement | null = null;
  private hideTimer: unknown | null = null;
  private readonly hideAfterMs: number;
  private readonly timers: SpeedHudTimers;

  constructor(host: HTMLElement, options: SpeedHudOptions = {}) {
    this.host = host;
    this.hideAfterMs = options.hideAfterMs ?? DEFAULT_HIDE_AFTER_MS;
    this.timers = options.timers ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  show(speed: number): void {
    this.cancelHideTimer();
    this.ensureNode();
    this.node!.textContent = `${speed.toFixed(1)}×`;
    this.node!.classList.add('active');
    this.hideTimer = this.timers.setTimeout(() => {
      this.node?.classList.remove('active');
      this.hideTimer = null;
    }, this.hideAfterMs);
  }

  private ensureNode(): void {
    if (this.node) return;
    const node = document.createElement('div');
    node.className = 'speed-hud';
    this.host.appendChild(node);
    this.node = node;
  }

  private cancelHideTimer(): void {
    if (this.hideTimer === null) return;
    this.timers.clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}
