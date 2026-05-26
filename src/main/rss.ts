import { BrowserWindow } from 'electron';

let timer: NodeJS.Timeout | null = null;

/**
 * Poll process.getProcessMemoryInfo() every 1000ms and broadcast `rss:update`
 * to the renderer with `{ bytes }`.
 */
export function startRssMonitor(win: BrowserWindow): void {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const info = await process.getProcessMemoryInfo();
      // info.resident is in KB on Electron; convert to bytes.
      const residentKb = (info as { resident?: number }).resident ?? 0;
      const bytes = residentKb * 1024;
      if (!win.isDestroyed()) {
        win.webContents.send('rss:update', { bytes });
      }
    } catch {
      // RSS reading errors are non-fatal; ignore.
    }
  }, 1000);
}

export function stopRssMonitor(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
