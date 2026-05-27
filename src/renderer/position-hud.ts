export interface PositionHudTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PositionHudOptions {
  hideAfterMs?: number;
  timers?: PositionHudTimers;
}

export interface PositionHudState {
  index: number;
  total: number;
  path?: string | null;
}

const DEFAULT_HIDE_AFTER_MS = 1100;

export class PositionHud {
  private host: HTMLElement;
  private node: HTMLDivElement | null = null;
  private countNode: HTMLDivElement | null = null;
  private nameNode: HTMLDivElement | null = null;
  private hideTimer: unknown | null = null;
  private readonly hideAfterMs: number;
  private readonly timers: PositionHudTimers;

  constructor(host: HTMLElement, options: PositionHudOptions = {}) {
    this.host = host;
    this.hideAfterMs = options.hideAfterMs ?? DEFAULT_HIDE_AFTER_MS;
    this.timers = options.timers ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  show(state: PositionHudState): void {
    if (state.total <= 0) return;
    this.cancelHideTimer();
    this.ensureNode();
    this.countNode!.textContent = `${state.index + 1} / ${state.total}`;
    this.nameNode!.textContent = fileNameForDisplay(state.path);
    this.node!.classList.add('active');
    this.hideTimer = this.timers.setTimeout(() => {
      this.node?.classList.remove('active');
      this.hideTimer = null;
    }, this.hideAfterMs);
  }

  private ensureNode(): void {
    if (this.node) return;
    const node = document.createElement('div');
    node.className = 'position-hud';
    const count = document.createElement('div');
    count.className = 'position-hud-count';
    const name = document.createElement('div');
    name.className = 'position-hud-name';
    node.appendChild(count);
    node.appendChild(name);
    this.host.appendChild(node);
    this.node = node;
    this.countNode = count;
    this.nameNode = name;
  }

  private cancelHideTimer(): void {
    if (this.hideTimer === null) return;
    this.timers.clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
}

function fileNameForDisplay(path: string | null | undefined): string {
  if (!path) return '';
  return path.split(/[\\/]/).pop() ?? path;
}
