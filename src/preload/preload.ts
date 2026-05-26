import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { AlbumLoadPayload, AlbumProgressPayload, RssUpdatePayload } from './api';

const api = {
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggleFullscreen'),
  showContextMenu: (point?: { x: number; y: number }): Promise<void> =>
    ipcRenderer.invoke('menu:show', point),
  updateSpeed: (speed: number): Promise<void> => ipcRenderer.invoke('speed:update', speed),
  readFile: async (filePath: string): Promise<Uint8Array> => {
    const buf = (await ipcRenderer.invoke('fs:readFile', filePath)) as Buffer | Uint8Array;
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  },
  openFileDialog: (): Promise<void> => ipcRenderer.invoke('dialog:openFile'),
  openFolderDialog: (): Promise<void> => ipcRenderer.invoke('dialog:openFolder'),
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  onAlbumLoad: (cb: (payload: AlbumLoadPayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: AlbumLoadPayload) => cb(payload);
    ipcRenderer.on('album:load', listener);
    return () => ipcRenderer.removeListener('album:load', listener);
  },
  onRssUpdate: (cb: (payload: RssUpdatePayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: RssUpdatePayload) => cb(payload);
    ipcRenderer.on('rss:update', listener);
    return () => ipcRenderer.removeListener('rss:update', listener);
  },
  onAlbumProgress: (cb: (payload: AlbumProgressPayload) => void): (() => void) => {
    const listener = (_e: IpcRendererEvent, payload: AlbumProgressPayload) => cb(payload);
    ipcRenderer.on('album:progress', listener);
    return () => ipcRenderer.removeListener('album:progress', listener);
  },
  onSortRequest: (cb: () => void): (() => void) => {
    const listener = () => cb();
    ipcRenderer.on('menu:sort-request', listener);
    return () => ipcRenderer.removeListener('menu:sort-request', listener);
  },
};

contextBridge.exposeInMainWorld('api', api);
