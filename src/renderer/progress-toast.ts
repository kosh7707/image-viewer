/**
 * progress-toast.ts — single sticky toast that reports album-load progress.
 *
 * Two phases: 'measuring' (header parsing in main process) and 'preloading'
 * (image decoding in renderer). The toast updates its text in place and
 * auto-dismisses when the final phase completes.
 */

export interface ProgressUpdate {
  phase: 'measuring' | 'preloading';
  completed: number;
  total: number;
  bytesSoFar?: number;
}

const PHASE_LABEL: Record<ProgressUpdate['phase'], string> = {
  measuring: '측정 중',
  preloading: '로딩 중',
};

export class ProgressToast {
  private host: HTMLElement;
  private node: HTMLDivElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  update(u: ProgressUpdate): void {
    if (u.total <= 0) {
      this.hide();
      return;
    }
    this.cancelHideTimer();
    this.ensureNode();
    const label = PHASE_LABEL[u.phase];
    const pct = u.total > 0 ? Math.round((u.completed / u.total) * 100) : 0;
    const sizePart =
      u.bytesSoFar !== undefined && u.bytesSoFar > 0
        ? ` · ${(u.bytesSoFar / 1024 / 1024).toFixed(0)} MB`
        : '';
    this.node!.textContent = `${label} ${u.completed} / ${u.total} (${pct}%)${sizePart}`;
    if (u.completed >= u.total && u.total > 0) {
      // Hide a moment after the phase completes; another phase may immediately
      // call update() and that will cancel this timer.
      this.scheduleHide(500);
    }
  }

  hide(): void {
    this.cancelHideTimer();
    if (this.node && this.node.parentNode) {
      this.node.parentNode.removeChild(this.node);
    }
    this.node = null;
  }

  private ensureNode(): void {
    if (this.node) return;
    const div = document.createElement('div');
    div.className = 'toast toast-progress';
    this.host.appendChild(div);
    this.node = div;
  }

  private scheduleHide(ms: number): void {
    this.hideTimer = setTimeout(() => {
      this.hide();
      this.hideTimer = null;
    }, ms);
  }

  private cancelHideTimer(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
