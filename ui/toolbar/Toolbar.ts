import type { EventEmitter } from '../../lib/event-emitter';

interface ButtonDef {
  label: string;
  icon: string;
  tooltip: string;
  toggle?: boolean;
}

const BUTTONS: ButtonDef[] = [
  { label: 'Annotate', icon: annotateIcon(), tooltip: 'Annotate (A)', toggle: true },
  { label: 'List Annotations', icon: listIcon(), tooltip: 'Annotations (L)', toggle: true },
  { label: 'Freeze Page', icon: freezeIcon(), tooltip: 'Freeze (F)', toggle: true },
  { label: 'Copy Markdown', icon: copyIcon(), tooltip: 'Copy Markdown (C)' },
  { label: 'Settings', icon: settingsIcon(), tooltip: 'Settings' },
];

export class Toolbar {
  private toolbarEl: HTMLElement;
  private annotateBtn: HTMLButtonElement;
  private listBtn: HTMLButtonElement;
  private freezeBtn: HTMLButtonElement;
  private annotateMode = false;
  private listOpen = false;
  private frozen = false;
  private unsubscribers: Array<() => void> = [];

  constructor(parent: HTMLElement, eventBus: EventEmitter) {
    this.toolbarEl = this.buildDOM(parent);
    this.annotateBtn = this.toolbarEl.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    this.listBtn = this.toolbarEl.querySelector('[aria-label="List Annotations"]') as HTMLButtonElement;
    this.freezeBtn = this.toolbarEl.querySelector('[aria-label="Freeze Page"]') as HTMLButtonElement;

    // Annotate button
    this.annotateBtn.addEventListener('click', () => {
      this.annotateMode = !this.annotateMode;
      this.annotateBtn.setAttribute('aria-pressed', String(this.annotateMode));
      eventBus.emit('annotate-mode', this.annotateMode);
    });

    // List toggle button
    this.listBtn.addEventListener('click', () => {
      this.listOpen = !this.listOpen;
      this.listBtn.setAttribute('aria-pressed', String(this.listOpen));
      eventBus.emit('list-toggle', this.listOpen);
    });

    // Freeze toggle button
    this.freezeBtn.addEventListener('click', () => {
      this.frozen = !this.frozen;
      this.freezeBtn.setAttribute('aria-pressed', String(this.frozen));
      eventBus.emit('freeze-toggle', this.frozen);
    });

    // Copy button
    const copyBtn = this.toolbarEl.querySelector('[aria-label="Copy Markdown"]') as HTMLButtonElement;
    copyBtn.addEventListener('click', () => {
      // emit copy with empty string — app layer will generate markdown
      eventBus.emit('copy', '');
    });

    // Settings button
    const settingsBtn = this.toolbarEl.querySelector('[aria-label="Settings"]') as HTMLButtonElement;
    settingsBtn.addEventListener('click', () => {
      browser.runtime.openOptionsPage?.().catch(() => {});
    });

    // Sync state back from eventBus
    const unsub1 = eventBus.on('annotate-mode', (active) => {
      this.annotateMode = active;
      this.annotateBtn.setAttribute('aria-pressed', String(active));
    });
    const unsub2 = eventBus.on('list-toggle', (open) => {
      this.listOpen = open;
      this.listBtn.setAttribute('aria-pressed', String(open));
    });
    const unsub3 = eventBus.on('freeze-toggle', (frozen) => {
      this.frozen = frozen;
      this.freezeBtn.setAttribute('aria-pressed', String(frozen));
    });
    this.unsubscribers.push(unsub1, unsub2, unsub3);
  }

  get isOpen(): boolean {
    return this.toolbarEl != null && this.toolbarEl.isConnected;
  }

  private buildDOM(parent: HTMLElement): HTMLElement {
    const toolbar = document.createElement('div');
    toolbar.className = 'agt-toolbar';
    toolbar.setAttribute('data-agt-ext', '');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', 'Agentation toolbar');

    for (const def of BUTTONS) {
      const btn = document.createElement('button');
      btn.className = 'agt-toolbar-btn';
      btn.setAttribute('aria-label', def.label);
      btn.setAttribute('data-tooltip', def.tooltip);
      if (def.toggle) btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = def.icon;

      // Add separator class to Copy Markdown and Settings buttons
      if (def.label === 'Copy Markdown' || def.label === 'Settings') {
        btn.classList.add('agt-toolbar-sep');
      }

      toolbar.appendChild(btn);
    }

    parent.appendChild(toolbar);
    return toolbar;
  }

  destroy(): void {
    this.unsubscribers.forEach((fn) => fn());
    this.toolbarEl.remove();
  }
}

// ---------------------------------------------------------------------------
// Inline SVG icons (18x18, stroke-width 1.4)
// ---------------------------------------------------------------------------

function annotateIcon(): string {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 2l10 10-4 4L2 6z"/>
    <line x1="10" y1="2" x2="16" y2="8"/>
    <line x1="2" y1="16" x2="6" y2="12"/>
  </svg>`;
}

function listIcon(): string {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
    <line x1="3" y1="4.5" x2="15" y2="4.5"/>
    <line x1="3" y1="9" x2="15" y2="9"/>
    <line x1="3" y1="13.5" x2="15" y2="13.5"/>
  </svg>`;
}

function freezeIcon(): string {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
    <line x1="9" y1="2" x2="9" y2="16"/>
    <line x1="2" y1="9" x2="16" y2="9"/>
    <line x1="4.5" y1="4.5" x2="13.5" y2="13.5"/>
    <line x1="13.5" y1="4.5" x2="4.5" y2="13.5"/>
  </svg>`;
}

function copyIcon(): string {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="6" y="6" width="9" height="9" rx="1.5"/>
    <path d="M3.5 12V3.5a1.5 1.5 0 011.5-1.5H12"/>
  </svg>`;
}

function settingsIcon(): string {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="9" cy="9" r="2.5"/>
    <path d="M9 1.5v2.2M9 14.3v2.2M1.5 9h2.2M14.3 9h2.2"/>
    <path d="M3.4 3.4l1.56 1.56M12.94 12.94l1.56 1.56M3.4 14.6l1.56-1.56M12.94 5.06l1.56-1.56"/>
  </svg>`;
}
