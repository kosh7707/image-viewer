/**
 * toast.ts — non-blocking RSS warning toast.
 *
 * Fires once per crossing from <=4GB to >4GB. Does not repeat until RSS
 * drops back below 4GB. Auto-dismiss after 5s, or manual dismiss.
 */

const FOUR_GB = 4 * 1024 * 1024 * 1024;
const AUTO_DISMISS_MS = 5000;

export class RssToast {
  private host: HTMLElement;
  private warnedThisCrossing = false;

  constructor(host: HTMLElement) {
    this.host = host;
  }

  install(): void {
    window.api.onRssUpdate(({ bytes }) => this.update(bytes));
  }

  private update(bytes: number): void {
    if (bytes > FOUR_GB) {
      if (!this.warnedThisCrossing) {
        this.warnedThisCrossing = true;
        this.show('Memory usage exceeded 4 GB');
      }
    } else {
      // RSS dropped back; arm the warning again.
      this.warnedThisCrossing = false;
    }
  }

  private show(message: string): void {
    const toast = document.createElement('div');
    toast.className = 'toast';
    const span = document.createElement('span');
    span.textContent = message;
    const close = document.createElement('button');
    close.className = 'close-btn';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });
    toast.appendChild(span);
    toast.appendChild(close);
    this.host.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, AUTO_DISMISS_MS);
  }
}
