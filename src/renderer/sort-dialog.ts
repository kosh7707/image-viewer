/**
 * sort-dialog.ts — modal that shows the loaded album in a table and lets the
 * user pick a sort key + order, or jump directly to a file by clicking its row.
 *
 * The dialog is built lazily on first open and reused.
 */

import type { AlbumEntryDTO } from '../preload/api';
import { sortAlbum, type SortKey, type SortOrder } from './album-sort';

export interface SortDialogCallbacks {
  onSortChange: (entries: AlbumEntryDTO[], newCurrentIndex: number) => void;
  onJumpTo: (index: number) => void;
}

export class SortDialog {
  private host: HTMLElement;
  private overlay: HTMLDivElement | null = null;
  private tableBody: HTMLTableSectionElement | null = null;
  private keySelect: HTMLSelectElement | null = null;
  private orderSelect: HTMLSelectElement | null = null;
  private current: { entries: AlbumEntryDTO[]; currentPath: string } | null = null;
  private cbs: SortDialogCallbacks;

  constructor(host: HTMLElement, cbs: SortDialogCallbacks) {
    this.host = host;
    this.cbs = cbs;
  }

  open(entries: AlbumEntryDTO[], currentPath: string): void {
    this.current = { entries: entries.slice(), currentPath };
    this.ensureBuilt();
    this.populate();
    this.overlay!.classList.add('active');
  }

  close(): void {
    if (this.overlay) this.overlay.classList.remove('active');
  }

  private ensureBuilt(): void {
    if (this.overlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'sort-dialog-overlay';
    const panel = document.createElement('div');
    panel.className = 'sort-dialog-panel';

    const header = document.createElement('div');
    header.className = 'sort-dialog-header';
    const title = document.createElement('h2');
    title.textContent = '정렬';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sort-dialog-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(title);
    header.appendChild(closeBtn);

    const controls = document.createElement('div');
    controls.className = 'sort-dialog-controls';
    const keySelect = document.createElement('select');
    keySelect.innerHTML = `
      <option value="filename">파일명</option>
      <option value="mtime">수정 시간</option>
    `;
    const orderSelect = document.createElement('select');
    orderSelect.innerHTML = `
      <option value="asc">오름차순</option>
      <option value="desc">내림차순</option>
    `;
    keySelect.addEventListener('change', () => this.applySort());
    orderSelect.addEventListener('change', () => this.applySort());
    controls.appendChild(this.labeled('정렬 기준', keySelect));
    controls.appendChild(this.labeled('순서', orderSelect));

    const tableWrap = document.createElement('div');
    tableWrap.className = 'sort-dialog-table-wrap';
    const table = document.createElement('table');
    table.className = 'sort-dialog-table';
    const thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>#</th><th>파일명</th><th>수정 시간</th></tr>';
    const tbody = document.createElement('tbody');
    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    panel.appendChild(header);
    panel.appendChild(controls);
    panel.appendChild(tableWrap);
    overlay.appendChild(panel);

    // Click on backdrop closes; click inside panel does not.
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) this.close();
    });

    this.host.appendChild(overlay);
    this.overlay = overlay;
    this.tableBody = tbody;
    this.keySelect = keySelect;
    this.orderSelect = orderSelect;
  }

  private labeled(label: string, control: HTMLElement): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'sort-dialog-label';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(span);
    wrap.appendChild(control);
    return wrap;
  }

  private populate(): void {
    if (!this.tableBody || !this.current) return;
    const { entries, currentPath } = this.current;
    this.tableBody.innerHTML = '';
    entries.forEach((e, i) => {
      const row = document.createElement('tr');
      if (e.path === currentPath) row.classList.add('current');
      const idx = document.createElement('td');
      idx.textContent = String(i + 1);
      const name = document.createElement('td');
      name.textContent = basename(e.path);
      name.title = e.path;
      const time = document.createElement('td');
      time.textContent = new Date(e.mtimeMs).toISOString().slice(0, 19).replace('T', ' ');
      row.appendChild(idx);
      row.appendChild(name);
      row.appendChild(time);
      row.addEventListener('click', () => {
        this.cbs.onJumpTo(i);
        this.close();
      });
      this.tableBody!.appendChild(row);
    });
  }

  private applySort(): void {
    if (!this.current || !this.keySelect || !this.orderSelect) return;
    const key = this.keySelect.value as SortKey;
    const order = this.orderSelect.value as SortOrder;
    const result = sortAlbum(this.current.entries, key, order, this.current.currentPath);
    this.current = { entries: result.entries, currentPath: this.current.currentPath };
    this.populate();
    this.cbs.onSortChange(result.entries, result.currentIndex);
  }
}

function basename(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i >= 0 ? p.slice(i + 1) : p;
}
