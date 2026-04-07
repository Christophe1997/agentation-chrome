import type { EventEmitter } from '../../lib/event-emitter';
import type { Annotation, AnnotationSyncStatus } from '../../lib/types';

const STATUS_LABELS: Record<AnnotationSyncStatus, string> = {
  pending: 'pending',
  syncing: 'syncing',
  synced: 'synced',
  failed: 'failed',
};

export class AnnotationList {
  private panel: HTMLElement;
  private listEl: HTMLElement;
  private eventBus: EventEmitter;
  private annotations: Annotation[] = [];
  private unsubscribers: Array<() => void> = [];

  constructor(parent: HTMLElement, eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.panel = this._buildDOM(parent);
    this.listEl = this.panel.querySelector('.agt-list-items') as HTMLElement;

    const unsub1 = eventBus.on('annotations-changed', (anns) => {
      this.annotations = anns;
      this._render();
    });
    const unsub2 = eventBus.on('sync-status-changed', (id, status) => {
      this._updateRowStatus(id, status);
    });
    this.unsubscribers.push(unsub1, unsub2);
  }

  toggle(open: boolean): void {
    this.panel.hidden = !open;
    this.panel.setAttribute('aria-hidden', String(!open));
  }

  destroy(): void {
    this.unsubscribers.forEach((fn) => fn());
    this.panel.remove();
  }

  private _buildDOM(parent: HTMLElement): HTMLElement {
    const panel = document.createElement('div');
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', 'Annotations');
    panel.setAttribute('data-agt-ext', '');
    panel.className = 'agt-list-panel';
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');

    panel.innerHTML = `
      <div class="agt-list-header">
        <span class="agt-list-title">Annotations</span>
        <button class="agt-list-clear-all" data-action="clear-all" hidden>Clear all</button>
      </div>
      <div class="agt-list-items"></div>
    `;

    const clearBtn = panel.querySelector('[data-action="clear-all"]') as HTMLButtonElement;
    clearBtn.addEventListener('click', () => this._handleClearAll());

    parent.appendChild(panel);
    return panel;
  }

  private _render(): void {
    this.listEl.innerHTML = '';

    const clearBtn = this.panel.querySelector('[data-action="clear-all"]') as HTMLButtonElement;
    clearBtn.hidden = this.annotations.length === 0;

    for (const ann of this.annotations) {
      const row = this._buildRow(ann);
      this.listEl.appendChild(row);
    }
  }

  private _buildRow(ann: Annotation): HTMLElement {
    const row = document.createElement('div');
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.setAttribute('data-annotation-id', ann.id);
    row.className = 'agt-list-row';

    const preview = ann.comment.length > 80
      ? ann.comment.slice(0, 80) + '...'
      : ann.comment;

    const syncStatus: AnnotationSyncStatus = 'pending';

    row.innerHTML = `
      <div class="agt-list-row-info">
        <span class="agt-list-element">${escapeHtml(ann.element)}</span>
        <span class="agt-list-comment">${escapeHtml(preview)}</span>
      </div>
      <div class="agt-list-row-meta">
        <span class="agt-list-status" data-status="${ann.status ?? syncStatus}">${STATUS_LABELS[ann.status as AnnotationSyncStatus] ?? 'pending'}</span>
        <button class="agt-list-delete-btn" data-action="delete-row" aria-label="Delete annotation">×</button>
      </div>
    `;

    const deleteBtn = row.querySelector('[data-action="delete-row"]') as HTMLButtonElement;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.eventBus.emit('annotation-delete', ann.id);
    });

    return row;
  }

  private _updateRowStatus(annotationId: string, status: AnnotationSyncStatus): void {
    const row = this.panel.querySelector(`[data-annotation-id="${annotationId}"]`);
    if (!row) return;
    const badge = row.querySelector('.agt-list-status') as HTMLElement;
    if (!badge) return;
    badge.setAttribute('data-status', status);
    badge.textContent = STATUS_LABELS[status] ?? status;
  }

  private _handleClearAll(): void {
    if (!window.confirm('Delete all annotations on this page?')) return;
    for (const ann of this.annotations) {
      this.eventBus.emit('annotation-delete', ann.id);
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
