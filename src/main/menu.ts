import { Menu, app, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import { openFileDialogAndLoad, openFolderDialogAndLoad } from './album-flow';

export interface MenuState {
  speedMultiplier: number;
}

export const menuState: MenuState = {
  speedMultiplier: 1.0,
};

export function showContextMenu(win: BrowserWindow): void {
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
  menu.popup({ window: win });
}
