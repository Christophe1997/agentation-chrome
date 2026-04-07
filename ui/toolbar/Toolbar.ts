import type { EventEmitter } from '../../lib/event-emitter';

interface ButtonDef {
  label: string;
  icon: string;
  toggle?: boolean;
}

const BUTTONS: ButtonDef[] = [
  { label: 'Annotate', icon: annotateIcon(), toggle: true },
  { label: 'Select Text', icon: selectTextIcon(), toggle: true },
  { label: 'List Annotations', icon: listIcon(), toggle: true },
  { label: 'Freeze Page', icon: freezeIcon(), toggle: true },
  { label: 'Copy Markdown', icon: copyIcon() },
  { label: 'Settings', icon: settingsIcon() },
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
      if (def.toggle) btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = def.icon;
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
// Inline SVG icons
// ---------------------------------------------------------------------------

function annotateIcon(): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="8" cy="8" r="6"/>
    <line x1="8" y1="5" x2="8" y2="11"/>
    <line x1="5" y1="8" x2="11" y2="8"/>
  </svg>`;
}

function selectTextIcon(): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M3 4h10M3 8h7M3 12h5"/>
  </svg>`;
}

function listIcon(): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <line x1="3" y1="4" x2="13" y2="4"/>
    <line x1="3" y1="8" x2="13" y2="8"/>
    <line x1="3" y1="12" x2="13" y2="12"/>
  </svg>`;
}

function freezeIcon(): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <path d="M8 2v12M2 8h12M4 4l8 8M12 4l-8 8"/>
  </svg>`;
}

function copyIcon(): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="5" y="5" width="8" height="8" rx="1"/>
    <path d="M3 11V3h8"/>
  </svg>`;
}

function settingsIcon(): string {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
    <circle cx="8" cy="8" r="2"/>
    <path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>
  </svg>`;
}
