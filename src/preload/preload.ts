import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { AlbumLoadPayload, RssUpdatePayload } from './api';

const api = {
  toggleFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggleFullscreen'),
  showContextMenu: (): Promise<void> => ipcRenderer.invoke('menu:show'),
  updateSpeed: (speed: number): Promise<void> => ipcRenderer.invoke('speed:update', speed),
  readFile: async (filePath: string): Promise<Uint8Array> => {
    const buf = (await ipcRenderer.invoke('fs:readFile', filePath)) as Buffer | Uint8Array;
    // Buffer is a Uint8Array subclass; normalize.
    return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  },
  openFileDialog: (): Promise<AlbumLoadPayload | null> => ipcRenderer.invoke('dialog:openFile'),
  openFolderDialog: (): Promise<AlbumLoadPayload | null> => ipcRenderer.invoke('dialog:openFolder'),
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
};

contextBridge.exposeInMainWorld('api', api);
