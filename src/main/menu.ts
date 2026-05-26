import { Menu, dialog, app, BrowserWindow, MenuItemConstructorOptions } from 'electron';
import * as path from 'path';
import { listImages, SUPPORTED_EXTS } from './folder';
import { setAlbumPaths } from './main';

export interface MenuState {
  speedMultiplier: number;
}

export const menuState: MenuState = {
  speedMultiplier: 1.0,
};

function extFilters() {
  return [
    {
      name: 'Images',
      extensions: SUPPORTED_EXTS.map((e) => e.replace(/^\./, '')),
    },
  ];
}

export function showContextMenu(win: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Open File...',
      click: async () => {
        const result = await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: extFilters(),
        });
        if (!result.canceled && result.filePaths[0]) {
          const file = result.filePaths[0];
          const folder = path.dirname(file);
          const images = listImages(folder);
          const idx = images.findIndex((p) => p === file);
          setAlbumPaths(images);
          win.webContents.send('album:load', {
            folder,
            images,
            currentIndex: idx >= 0 ? idx : 0,
          });
        }
      },
    },
    {
      label: 'Open Folder...',
      click: async () => {
        const result = await dialog.showOpenDialog(win, {
          properties: ['openDirectory'],
        });
        if (!result.canceled && result.filePaths[0]) {
          const folder = result.filePaths[0];
          const images = listImages(folder);
          setAlbumPaths(images);
          win.webContents.send('album:load', {
            folder,
            images,
            currentIndex: 0,
          });
        }
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
