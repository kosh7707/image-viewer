import type { UserPreferences } from '../shared/user-preferences';
import {
  DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES,
  formatMemoryLimit,
  gbToMemoryLimitBytes,
  normalizeAnimatedPreloadMemoryLimitBytes,
} from '../shared/user-preferences';

export interface MemoryLimitOption {
  label: string;
  valueBytes: number | null;
}

export interface SettingsDialogCallbacks {
  onSavePreloadLimit: (bytes: number) => Promise<UserPreferences>;
}

export function memoryLimitPresetOptions(): MemoryLimitOption[] {
  return [
    { label: '1 GB', valueBytes: gbToMemoryLimitBytes(1) },
    { label: '2 GB', valueBytes: gbToMemoryLimitBytes(2) },
    {
      label: `${formatMemoryLimit(DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES)} Recommended`,
      valueBytes: DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES,
    },
    { label: '8 GB', valueBytes: gbToMemoryLimitBytes(8) },
    { label: 'Custom', valueBytes: null },
  ];
}

export function settingsSummaryText({
  estimatedBytes,
  limitBytes,
}: {
  estimatedBytes: number;
  limitBytes: number;
}): string {
  const mode = estimatedBytes > limitBytes ? 'Rolling preload' : 'Full preload';
  return `Current folder estimate: ${formatMemoryLimit(estimatedBytes)} · Limit: ${formatMemoryLimit(
    limitBytes,
  )} · ${mode}`;
}

export class SettingsDialog {
  private host: HTMLElement;
  private cbs: SettingsDialogCallbacks;
  private overlay: HTMLDivElement | null = null;
  private customInput: HTMLInputElement | null = null;
  private selectedBytes = DEFAULT_ANIMATED_PRELOAD_MEMORY_LIMIT_BYTES;

  constructor(host: HTMLElement, cbs: SettingsDialogCallbacks) {
    this.host = host;
    this.cbs = cbs;
  }

  open(preferences: UserPreferences): void {
    this.selectedBytes = preferences.preload.animatedMemoryLimitBytes;
    this.ensureBuilt();
    this.syncControls();
    this.overlay!.classList.add('active');
  }

  close(): void {
    if (this.overlay) this.overlay.classList.remove('active');
  }

  isOpen(): boolean {
    return this.overlay?.classList.contains('active') ?? false;
  }

  private ensureBuilt(): void {
    if (this.overlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'settings-dialog-overlay';
    const panel = document.createElement('div');
    panel.className = 'settings-dialog-panel';

    const header = document.createElement('div');
    header.className = 'settings-dialog-header';
    const title = document.createElement('h2');
    title.textContent = 'Settings';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'settings-dialog-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => this.close());
    header.appendChild(title);
    header.appendChild(closeBtn);

    const section = document.createElement('section');
    section.className = 'settings-section';
    const sectionTitle = document.createElement('h3');
    sectionTitle.textContent = 'Preload';
    const description = document.createElement('p');
    description.textContent =
      'Images are kept ready within this memory limit. The viewer fills the budget from the current image outward and unloads far items first.';

    const options = document.createElement('div');
    options.className = 'settings-memory-options';
    for (const option of memoryLimitPresetOptions()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = option.label;
      button.dataset.valueBytes = option.valueBytes === null ? 'custom' : String(option.valueBytes);
      button.addEventListener('click', () => {
        if (option.valueBytes !== null) {
          this.selectedBytes = option.valueBytes;
          this.syncControls();
        } else {
          this.customInput?.focus();
        }
      });
      options.appendChild(button);
    }

    const customLabel = document.createElement('label');
    customLabel.className = 'settings-custom-limit';
    const customText = document.createElement('span');
    customText.textContent = 'Custom';
    const customInput = document.createElement('input');
    customInput.type = 'number';
    customInput.min = '0.5';
    customInput.max = '32';
    customInput.step = '0.1';
    const suffix = document.createElement('span');
    suffix.textContent = 'GB';
    customInput.addEventListener('input', () => {
      const gb = Number(customInput.value);
      if (Number.isFinite(gb)) {
        this.selectedBytes = normalizeAnimatedPreloadMemoryLimitBytes(gbToMemoryLimitBytes(gb));
      }
    });
    customLabel.appendChild(customText);
    customLabel.appendChild(customInput);
    customLabel.appendChild(suffix);
    this.customInput = customInput;

    const actions = document.createElement('div');
    actions.className = 'settings-actions';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save';
    save.addEventListener('click', () => {
      void this.cbs.onSavePreloadLimit(this.selectedBytes).then((prefs) => {
        this.selectedBytes = prefs.preload.animatedMemoryLimitBytes;
        this.close();
      });
    });
    actions.appendChild(save);

    section.appendChild(sectionTitle);
    section.appendChild(description);
    section.appendChild(options);
    section.appendChild(customLabel);
    panel.appendChild(header);
    panel.appendChild(section);
    panel.appendChild(actions);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) this.close();
    });

    this.host.appendChild(overlay);
    this.overlay = overlay;
  }

  private syncControls(): void {
    if (!this.overlay) return;
    const buttons = this.overlay.querySelectorAll<HTMLButtonElement>(
      '.settings-memory-options button',
    );
    for (const button of buttons) {
      const value = button.dataset.valueBytes;
      const active = value !== 'custom' && Number(value) === this.selectedBytes;
      button.classList.toggle('active', active);
    }
    if (this.customInput) {
      this.customInput.value = String(this.selectedBytes / gbToMemoryLimitBytes(1));
    }
  }
}
