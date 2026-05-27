import { Menu, app, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { openFileDialogAndLoad, openFolderDialogAndLoad } from './album-flow';

export interface MenuState {
  speedMultiplier: number;
}

export const menuState: MenuState = {
  speedMultiplier: 1.0,
};

export interface MenuPoint {
  x: number;
  y: number;
}

function normalizePoint(point: MenuPoint | undefined): MenuPoint | undefined {
  if (!point) return undefined;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return undefined;
  return {
    x: Math.max(0, Math.round(point.x)),
    y: Math.max(0, Math.round(point.y)),
  };
}

export function showContextMenu(win: BrowserWindow, point?: MenuPoint): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Open File...',
      click: () => {
        void openFileDialogAndLoad(win);
      },
    },
    {
      label: 'Open Folder...',
      click: () => {
        void openFolderDialogAndLoad(win);
      },
    },
    { type: 'separator' },
    {
      label: 'Sort...',
      click: () => {
        win.webContents.send('menu:sort-request');
      },
    },
    {
      label: 'Settings...',
      click: () => {
        win.webContents.send('menu:settings-request');
      },
    },
    { type: 'separator' },
    {
      label: `Speed: ${menuState.speedMultiplier.toFixed(1)}x`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        app.quit();
      },
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  const popupPoint = normalizePoint(point);
  menu.popup(popupPoint ? { window: win, ...popupPoint } : { window: win });
}
