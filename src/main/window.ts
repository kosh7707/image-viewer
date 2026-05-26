import { BrowserWindow } from 'electron';

export function toggleFullscreen(win: BrowserWindow): boolean {
  const next = !win.isFullScreen();
  win.setFullScreen(next);
  win.setMenuBarVisibility(false);
  return next;
}
