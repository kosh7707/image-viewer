export type PreloadPanelItemState = 'current' | 'ready' | 'loading';
export type PreloadPanelItemKind = 'animation' | 'native' | 'static';

export interface PreloadPanelItem {
  index: number;
  path: string;
  state: PreloadPanelItemState;
  kind: PreloadPanelItemKind;
}

export interface PreloadPanelSnapshot {
  currentIndex: number;
  total: number;
  items: PreloadPanelItem[];
}

export interface PreloadPanelTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PreloadPanelOptions {
  activeAfterUpdateMs?: number;
  timers?: PreloadPanelTimers;
}

const DEFAULT_ACTIVE_AFTER_UPDATE_MS = 1400;

export class PreloadPanel {
  private host: HTMLElement;
  private node: HTMLDivElement | null = null;
  private listNode: HTMLDivElement | null = null;
  private summaryNode: HTMLDivElement | null = null;
  private pinButton: HTMLButtonElement | null = null;
  private pinned = false;
  private activeTimer: unknown | null = null;
  private readonly activeAfterUpdateMs: number;
  private readonly timers: PreloadPanelTimers;

  constructor(host: HTMLElement, options: PreloadPanelOptions = {}) {
    this.host = host;
    this.activeAfterUpdateMs = options.activeAfterUpdateMs ?? DEFAULT_ACTIVE_AFTER_UPDATE_MS;
    this.timers = options.timers ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }

  update(snapshot: PreloadPanelSnapshot, options: { reveal?: boolean } = {}): void {
    this.ensureNode();
    this.summaryNode!.textContent =
      snapshot.total > 0 ? `${snapshot.currentIndex + 1} / ${snapshot.total}` : 'No album';
    this.renderItems(snapshot.items);
    this.node!.classList.toggle('empty', snapshot.items.length === 0);
    if (options.reveal) this.revealTemporarily();
  }

  isPinned(): boolean {
    return this.pinned;
  }

  private renderItems(items: PreloadPanelItem[]): void {
    this.listNode!.replaceChildren();
    for (const item of items) {
      const row = document.createElement('div');
      row.className = `preload-panel-row ${item.state}`;
      const marker = document.createElement('span');
      marker.className = 'preload-panel-marker';
      marker.textContent = markerForState(item.state);
      const index = document.createElement('span');
      index.className = 'preload-panel-index';
      index.textContent = String(item.index + 1);
      const name = document.createElement('span');
      name.className = 'preload-panel-name';
      name.textContent = fileNameForDisplay(item.path);
      const kind = document.createElement('span');
      kind.className = 'preload-panel-kind';
      kind.textContent = kindLabel(item.kind);
      row.appendChild(marker);
      row.appendChild(index);
      row.appendChild(name);
      row.appendChild(kind);
      this.listNode!.appendChild(row);
    }
  }

  private revealTemporarily(): void {
    this.cancelActiveTimer();
    this.node!.classList.add('active');
    if (this.pinned) return;
    this.activeTimer = this.timers.setTimeout(() => {
      this.node?.classList.remove('active');
      this.activeTimer = null;
    }, this.activeAfterUpdateMs);
  }

  private ensureNode(): void {
    if (this.node) return;
    const node = document.createElement('div');
    node.className = 'preload-panel';

    const header = document.createElement('div');
    header.className = 'preload-panel-header';
    const title = document.createElement('div');
    title.className = 'preload-panel-title';
    title.textContent = 'Ready';
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'preload-panel-pin';
    pin.setAttribute('aria-label', 'Pin preload panel');
    pin.textContent = '○';
    pin.addEventListener('click', () => this.togglePinned());
    header.appendChild(title);
    header.appendChild(pin);

    const summary = document.createElement('div');
    summary.className = 'preload-panel-summary';
    const list = document.createElement('div');
    list.className = 'preload-panel-list';

    node.appendChild(header);
    node.appendChild(summary);
    node.appendChild(list);
    this.host.appendChild(node);

    this.node = node;
    this.listNode = list;
    this.summaryNode = summary;
    this.pinButton = pin;
  }

  private togglePinned(): void {
    this.pinned = !this.pinned;
    this.node!.classList.toggle('pinned', this.pinned);
    this.node!.classList.add('active');
    this.pinButton!.textContent = this.pinned ? '●' : '○';
    this.pinButton!.setAttribute(
      'aria-label',
      this.pinned ? 'Unpin preload panel' : 'Pin preload panel',
    );
    if (!this.pinned) this.revealTemporarily();
  }

  private cancelActiveTimer(): void {
    if (this.activeTimer === null) return;
    this.timers.clearTimeout(this.activeTimer);
    this.activeTimer = null;
  }
}

function markerForState(state: PreloadPanelItemState): string {
  if (state === 'current') return '●';
  if (state === 'loading') return '…';
  return '✓';
}

function kindLabel(kind: PreloadPanelItemKind): string {
  if (kind === 'animation') return 'A';
  if (kind === 'native') return 'N';
  return 'S';
}

function fileNameForDisplay(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
