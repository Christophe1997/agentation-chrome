import type { EventEmitter } from '../../lib/event-emitter';
import type { Annotation, AnnotationSyncStatus } from '../../lib/types';
import { detectTheme, watchBodyStyle, type Theme } from '../../lib/theme-detector';

// ── Button definitions ──────────────────────────────────────────────────────

interface ButtonDef {
  label: string;
  icon: string;
  tooltip: string;
  toggle?: boolean;
}

const BUTTONS: ButtonDef[] = [
  { label: 'Annotate', icon: annotateIcon(), tooltip: 'Annotate', toggle: true },
  { label: 'List Annotations', icon: listIcon(), tooltip: 'Annotations', toggle: true },
  { label: 'Freeze Page', icon: freezeIcon(), tooltip: 'Freeze', toggle: true },
  { label: 'Copy Markdown', icon: copyIcon(), tooltip: 'Copy Markdown' },
  { label: 'Settings', icon: settingsIcon(), tooltip: 'Settings' },
];

// ── Status labels ───────────────────────────────────────────────────────────

const STATUS_LABELS: Record<AnnotationSyncStatus, string> = {
  pending: 'pending',
  syncing: 'syncing',
  synced: 'synced',
  failed: 'failed',
};

// ── Toolbox class ───────────────────────────────────────────────────────────

export class Toolbox {
  private containerEl: HTMLElement;
  private listSectionEl: HTMLElement;
  private listItemsEl: HTMLElement;
  private annotateBtn: HTMLButtonElement;
  private listBtn: HTMLButtonElement;
  private freezeBtn: HTMLButtonElement;
  private copyBtn: HTMLButtonElement;
  private clearAllBtn: HTMLButtonElement;

  private annotateMode = false;
  private listOpen = false;
  private frozen = false;
  private annotations: Annotation[] = [];
  private eventBus: EventEmitter;
  private unsubscribers: Array<() => void> = [];
  private disconnectThemeWatcher: (() => void) | null = null;
  private copyFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement, eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.containerEl = this._buildDOM(parent);

    // Grab references
    this.annotateBtn = this.containerEl.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    this.listBtn = this.containerEl.querySelector('[aria-label="List Annotations"]') as HTMLButtonElement;
    this.freezeBtn = this.containerEl.querySelector('[aria-label="Freeze Page"]') as HTMLButtonElement;
    this.copyBtn = this.containerEl.querySelector('[aria-label="Copy Markdown"]') as HTMLButtonElement;
    this.clearAllBtn = this.containerEl.querySelector('[data-action="clear-all"]') as HTMLButtonElement;
    this.listSectionEl = this.containerEl.querySelector('.agt-toolbox-list') as HTMLElement;
    this.listItemsEl = this.containerEl.querySelector('.agt-toolbox-list-items') as HTMLElement;

    // ── Button handlers ──

    this.annotateBtn.addEventListener('click', () => {
      this.annotateMode = !this.annotateMode;
      this.annotateBtn.setAttribute('aria-pressed', String(this.annotateMode));
      eventBus.emit('annotate-mode', this.annotateMode);
    });

    this.listBtn.addEventListener('click', () => {
      this.listOpen = !this.listOpen;
      this.listBtn.setAttribute('aria-pressed', String(this.listOpen));
      this._setExpanded(this.listOpen);
      eventBus.emit('list-toggle', this.listOpen);
    });

    this.freezeBtn.addEventListener('click', () => {
      this.frozen = !this.frozen;
      this.freezeBtn.setAttribute('aria-pressed', String(this.frozen));
      eventBus.emit('freeze-toggle', this.frozen);
    });

    this.copyBtn.addEventListener('click', () => {
      eventBus.emit('copy', '');
    });

    const settingsBtn = this.containerEl.querySelector('[aria-label="Settings"]') as HTMLButtonElement;
    settingsBtn.addEventListener('click', () => {
      browser.runtime.openOptionsPage?.().catch(() => {});
    });

    this.clearAllBtn.addEventListener('click', () => this._handleClearAll(eventBus));

    // ── Sync state back from eventBus ──

    const unsub1 = eventBus.on('annotate-mode', (active) => {
      this.annotateMode = active;
      this.annotateBtn.setAttribute('aria-pressed', String(active));
    });
    const unsub2 = eventBus.on('list-toggle', (open) => {
      this.listOpen = open;
      this.listBtn.setAttribute('aria-pressed', String(open));
      this._setExpanded(open);
    });
    const unsub3 = eventBus.on('freeze-toggle', (frozen) => {
      this.frozen = frozen;
      this.freezeBtn.setAttribute('aria-pressed', String(frozen));
    });
    const unsub4 = eventBus.on('annotations-changed', (anns) => {
      const prevLength = this.annotations.length;
      this.annotations = anns;
      this._renderList();
      // Scroll to bottom if a new annotation was added
      if (anns.length > prevLength) {
        requestAnimationFrame(() => {
          this.listItemsEl.scrollTop = this.listItemsEl.scrollHeight;
        });
      }
    });
    const unsub5 = eventBus.on('sync-status-changed', (id, status) => {
      this._updateRowStatus(id, status);
    });
    const unsub6 = eventBus.on('copy-success', () => {
      this._showCopyFeedback();
    });
    this.unsubscribers.push(unsub1, unsub2, unsub3, unsub4, unsub5, unsub6);

    // ── Adaptive theme ──

    this._applyTheme(detectTheme());
    this.disconnectThemeWatcher = watchBodyStyle(() => {
      this._applyTheme(detectTheme());
    });

    // Start with list expanded by default
    this._setExpanded(true);
    this.listOpen = true;
    this.listBtn.setAttribute('aria-pressed', 'true');
  }

  get isOpen(): boolean {
    return this.containerEl != null && this.containerEl.isConnected;
  }

  destroy(): void {
    this.unsubscribers.forEach((fn) => fn());
    if (this.disconnectThemeWatcher) this.disconnectThemeWatcher();
    if (this.copyFeedbackTimer) clearTimeout(this.copyFeedbackTimer);
    this.containerEl.remove();
  }

  // ── DOM construction ─────────────────────────────────────────────────────

  private _buildDOM(parent: HTMLElement): HTMLElement {
    const container = document.createElement('div');
    container.className = 'agt-toolbox';
    container.setAttribute('data-agt-ext', '');
    container.setAttribute('data-agt-theme', 'dark');
    container.setAttribute('role', 'toolbar');
    container.setAttribute('aria-label', 'Agentation toolbox');

    // Header — button row
    const header = document.createElement('div');
    header.className = 'agt-toolbox-header';

    for (const def of BUTTONS) {
      const btn = document.createElement('button');
      btn.className = 'agt-toolbox-btn';
      btn.setAttribute('aria-label', def.label);
      btn.setAttribute('data-tooltip', def.tooltip);
      if (def.toggle) btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = def.icon;

      if (def.label === 'Copy Markdown' || def.label === 'Settings') {
        btn.classList.add('agt-toolbox-sep');
      }

      header.appendChild(btn);
    }

    container.appendChild(header);

    // Expandable list section
    const listSection = document.createElement('div');
    listSection.className = 'agt-toolbox-list';

    listSection.innerHTML = `
      <div class="agt-toolbox-list-header">
        <span class="agt-toolbox-list-title">Annotations</span>
        <button class="agt-toolbox-clear-all" data-action="clear-all" hidden>Clear all</button>
      </div>
      <div class="agt-toolbox-list-items"></div>
    `;

    container.appendChild(listSection);
    parent.appendChild(container);
    return container;
  }

  // ── List rendering ───────────────────────────────────────────────────────

  private _renderList(): void {
    this.listItemsEl.innerHTML = '';
    this.clearAllBtn.hidden = this.annotations.length === 0;

    if (this.annotations.length === 0) {
      this.listItemsEl.innerHTML = `
        <div class="agt-toolbox-empty">
          <span class="agt-toolbox-empty-icon">${annotateIcon()}</span>
          <span class="agt-toolbox-empty-text">No annotations yet</span>
        </div>
      `;
      return;
    }

    for (const ann of this.annotations) {
      this.listItemsEl.appendChild(this._buildCard(ann));
    }
  }

  private _buildCard(ann: Annotation): HTMLElement {
    const card = document.createElement('div');
    card.setAttribute('role', 'option');
    card.setAttribute('aria-selected', 'false');
    card.setAttribute('data-annotation-id', ann.id);
    card.className = 'agt-toolbox-card';

    const preview = ann.comment.length > 80 ? ann.comment.slice(0, 80) + '...' : ann.comment;
    const syncStatus: AnnotationSyncStatus = 'pending';

    card.innerHTML = `
      <div class="agt-toolbox-card-info">
        <span class="agt-toolbox-element">${escapeHtml(ann.element)}</span>
        <span class="agt-toolbox-comment">${escapeHtml(preview)}</span>
      </div>
      <div class="agt-toolbox-card-meta">
        <span class="agt-toolbox-status" data-status="${ann.status ?? syncStatus}">${STATUS_LABELS[ann.status as AnnotationSyncStatus] ?? 'pending'}</span>
        <button class="agt-toolbox-delete-btn" data-action="delete-row" aria-label="Delete annotation">&times;</button>
      </div>
    `;

    // Delete button
    const deleteBtn = card.querySelector('[data-action="delete-row"]') as HTMLButtonElement;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.eventBus.emit('annotation-delete', ann.id);
    });

    // Click card → open edit dialog
    card.addEventListener('click', () => {
      this.eventBus.emit('marker-click', ann.id);
    });

    return card;
  }

  private _updateRowStatus(annotationId: string, status: AnnotationSyncStatus): void {
    const row = this.containerEl.querySelector(`[data-annotation-id="${annotationId}"]`);
    if (!row) return;
    const badge = row.querySelector('.agt-toolbox-status') as HTMLElement;
    if (!badge) return;
    badge.setAttribute('data-status', status);
    badge.textContent = STATUS_LABELS[status] ?? status;
  }

  // ── Expanded/collapsed state ──────────────────────────────────────────────

  private _setExpanded(expanded: boolean): void {
    if (expanded) {
      this.containerEl.classList.add('agt-toolbox--expanded');
      this.listSectionEl.setAttribute('aria-hidden', 'false');
    } else {
      this.containerEl.classList.remove('agt-toolbox--expanded');
      this.listSectionEl.setAttribute('aria-hidden', 'true');
    }
  }

  // ── Theme ────────────────────────────────────────────────────────────────

  private _applyTheme(theme: Theme): void {
    this.containerEl.setAttribute('data-agt-theme', theme);
  }

  // ── Copy feedback ────────────────────────────────────────────────────────

  private _showCopyFeedback(): void {
    this.copyBtn.classList.add('agt-toolbox-btn--copied');
    this.copyBtn.innerHTML = checkmarkIcon();
    if (this.copyFeedbackTimer) clearTimeout(this.copyFeedbackTimer);
    this.copyFeedbackTimer = setTimeout(() => {
      this.copyBtn.classList.remove('agt-toolbox-btn--copied');
      this.copyBtn.innerHTML = copyIcon();
      this.copyFeedbackTimer = null;
    }, 1500);
  }

  // ── Clear all ────────────────────────────────────────────────────────────

  private _handleClearAll(eventBus: EventEmitter): void {
    if (!window.confirm('Delete all annotations on this page?')) return;
    for (const ann of this.annotations) {
      eventBus.emit('annotation-delete', ann.id);
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Inline SVG icons (18x18, stroke-width 1.4) ─────────────────────────────

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

function checkmarkIcon(): string {
  return `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3.5 9.5 7 13 14.5 5"/>
  </svg>`;
}
