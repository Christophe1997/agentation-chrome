import type { EventEmitter } from '../../lib/event-emitter';
import type { ElementInfo } from '../../lib/element-identification';
import type { Annotation } from '../../lib/types';

function uuid(): string {
  return crypto.randomUUID();
}

export class AnnotationDialog {
  private container: HTMLElement;
  private eventBus: EventEmitter;
  private triggerButton: HTMLElement | null = null;
  private currentInfo: ElementInfo | null = null;
  private currentAnnotation: Annotation | null = null;

  constructor(parent: HTMLElement, eventBus: EventEmitter) {
    this.eventBus = eventBus;
    this.container = this._buildDOM(parent);
    this._attachListeners();
  }

  open(
    elementInfo: ElementInfo,
    position: { x: number; y: number },
    selectedText?: string,
    existingAnnotation?: Annotation,
  ): void {
    this.currentInfo = elementInfo;
    this.currentAnnotation = existingAnnotation ?? null;

    // Populate header
    const titleEl = this.container.querySelector('#agt-dialog-title') as HTMLElement;
    titleEl.textContent = elementInfo.name;

    // Populate element path
    const pathEl = this.container.querySelector('.agt-dialog-path') as HTMLElement;
    pathEl.textContent = elementInfo.path;

    // Populate textarea
    const textarea = this.container.querySelector('textarea') as HTMLTextAreaElement;
    if (existingAnnotation) {
      textarea.value = existingAnnotation.comment;
    } else {
      textarea.value = selectedText ?? '';
    }

    // Show/hide delete button
    const deleteBtn = this.container.querySelector('button[data-action="delete"]') as HTMLButtonElement;
    deleteBtn.hidden = !existingAnnotation;

    // Position near click, clamp to viewport
    this._positionDialog(position);

    this.container.hidden = false;
    textarea.focus();
  }

  close(): void {
    this.container.hidden = true;
    this.triggerButton?.focus();
    this.triggerButton = null;
    this.currentInfo = null;
    this.currentAnnotation = null;
    this.eventBus.emit('popup-close');
  }

  destroy(): void {
    this.container.remove();
  }

  private _buildDOM(parent: HTMLElement): HTMLElement {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'agt-dialog-title');
    dialog.setAttribute('data-agt-ext', '');
    dialog.className = 'agt-dialog';
    dialog.hidden = true;

    dialog.innerHTML = `
      <div class="agt-dialog-header">
        <span id="agt-dialog-title" class="agt-dialog-title"></span>
        <button class="agt-dialog-close" aria-label="Close dialog" data-action="close">&times;</button>
      </div>
      <div class="agt-dialog-element-info">
        <div class="agt-dialog-path"></div>
      </div>
      <div class="agt-dialog-body">
        <textarea class="agt-dialog-textarea" placeholder="Describe the issue or feedback..." rows="3"></textarea>
      </div>
      <div class="agt-dialog-footer">
        <button class="agt-dialog-btn agt-dialog-btn--delete" data-action="delete" hidden>Delete</button>
        <button class="agt-dialog-btn agt-dialog-btn--cancel" data-action="cancel">Cancel</button>
        <button class="agt-dialog-btn agt-dialog-btn--submit" data-action="submit">Submit</button>
      </div>
    `;

    parent.appendChild(dialog);
    return dialog;
  }

  private _attachListeners(): void {
    // Close / cancel
    this.container.querySelector('[data-action="close"]')!.addEventListener('click', () => this.close());
    this.container.querySelector('[data-action="cancel"]')!.addEventListener('click', () => this.close());

    // Submit
    this.container.querySelector('[data-action="submit"]')!.addEventListener('click', () => this._handleSubmit());

    // Delete
    this.container.querySelector('[data-action="delete"]')!.addEventListener('click', () => this._handleDelete());

    // Keyboard
    this.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.close();
      }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._handleSubmit();
      }
    });
  }

  private _handleSubmit(): void {
    const textarea = this.container.querySelector('textarea') as HTMLTextAreaElement;
    const comment = textarea.value.trim();
    if (!comment) return;

    if (!this.currentInfo) return;

    const annotation: Annotation = this.currentAnnotation
      ? { ...this.currentAnnotation, comment, updatedAt: new Date().toISOString() }
      : {
          id: uuid(),
          comment,
          element: this.currentInfo.name,
          elementPath: this.currentInfo.path,
          fullPath: this.currentInfo.fullPath,
          x: 0,
          y: 0,
          timestamp: Date.now(),
          cssClasses: this.currentInfo.cssClasses,
          computedStyles: this.currentInfo.computedStyles,
          boundingBox: this.currentInfo.boundingBox,
          accessibility: this.currentInfo.accessibility,
          nearbyElements: this.currentInfo.nearbyElements,
          nearbyText: this.currentInfo.nearbyText,
          status: 'pending',
        };

    this.eventBus.emit('annotation-submit', annotation);
    this.close();
  }

  private _handleDelete(): void {
    if (!this.currentAnnotation) return;
    this.eventBus.emit('annotation-delete', this.currentAnnotation.id);
    this.close();
  }

  private _positionDialog(position: { x: number; y: number }): void {
    const MARGIN = 8;
    const MAX_WIDTH = 420;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;

    let left = position.x;
    let top = position.y;

    // Clamp horizontally
    if (left + MAX_WIDTH + MARGIN > vw) {
      left = Math.max(MARGIN, vw - MAX_WIDTH - MARGIN);
    }
    // Clamp vertically (estimate dialog height ~300px)
    if (top + 300 + MARGIN > vh) {
      top = Math.max(MARGIN, vh - 300 - MARGIN);
    }

    this.container.style.left = `${left}px`;
    this.container.style.top = `${top}px`;
  }
}
