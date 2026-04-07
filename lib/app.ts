import { EventEmitter } from './event-emitter';
import { identifyElement } from './element-identification';
import { identifyElementWithReact } from './react-detection';
import { Toolbox } from '../ui/toolbox/Toolbox';
import { MarkerRegistry } from '../ui/markers/MarkerRegistry';
import { AnnotationDialog } from '../ui/dialog/AnnotationDialog';
import { generateMarkdown, copyToClipboard } from './generate-output';
import { freeze, unfreeze, isFrozen } from './freeze-animations';
import { saveAnnotation, loadAnnotations, deleteAnnotation as deleteAnnotationFromStorage, loadSettings } from './storage';
import { SELECTORS } from './constants';
import type { Annotation } from './types';

export class AgentationApp {
  private eventBus: EventEmitter;
  private toolbox: Toolbox;
  private markerRegistry: MarkerRegistry;
  private dialog: AnnotationDialog;
  private url: string;
  private annotations: Annotation[] = [];
  private tabId: number | null = null;
  private sessionId: string | null = null;
  private captureListener: ((e: PointerEvent) => void) | null = null;
  private hoverListener: ((e: PointerEvent) => void) | null = null;
  private hoverOverlay: HTMLElement | null = null;
  private pushStateOrig: typeof history.pushState;
  private replaceStateOrig: typeof history.replaceState;
  private savedCursor: string = '';
  private escHandler: ((e: KeyboardEvent) => void) | null = null;
  private annotateActive = false;
  private listVisible = false;

  constructor(container: HTMLElement, _shadow: ShadowRoot) {
    this.eventBus = new EventEmitter();
    this.url = window.location.href;

    this.markerRegistry = new MarkerRegistry(this.eventBus);
    this.toolbox = new Toolbox(container, this.eventBus);
    this.dialog = new AnnotationDialog(container, this.eventBus);

    this._wireEventBus();

    this.escHandler = this._handleGlobalEsc.bind(this);
    document.addEventListener('keydown', this.escHandler);

    this.pushStateOrig = history.pushState.bind(history);
    this.replaceStateOrig = history.replaceState.bind(history);
    this.setupNavigationDetection();

    // Load tab ID and restore markers on next frame
    requestAnimationFrame(() => this._initTabAndAnnotations());
  }

  enableAnnotateMode(): void {
    if (this.captureListener) return;
    this.savedCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'default';

    // Persistent hover highlight overlay — follows element under cursor
    const overlay = document.createElement('div');
    overlay.setAttribute('data-agt-ext', '');
    overlay.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483645;box-sizing:border-box;' +
      'border:2px solid rgba(99,102,241,0.9);background:rgba(99,102,241,0.08);' +
      'border-radius:2px;transition:none;display:none;';
    document.body.appendChild(overlay);
    this.hoverOverlay = overlay;

    // Hover: highlight element bounding box under cursor
    this.hoverListener = (e: PointerEvent) => {
      if (this.dialog.isOpen) { overlay.style.display = 'none'; return; }
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!target || target === document.body || target === document.documentElement) {
        overlay.style.display = 'none';
        return;
      }
      if (target.closest(SELECTORS.EXTENSION) || target.closest(SELECTORS.ROOT)) {
        overlay.style.display = 'none';
        return;
      }
      // Batch: read rect first, then write styles
      const rect = target.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.left   = `${rect.left}px`;
      overlay.style.top    = `${rect.top}px`;
      overlay.style.width  = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    };
    document.addEventListener('pointermove', this.hoverListener);

    // Click: pick the element under cursor and open annotation dialog
    this.captureListener = (e: PointerEvent) => {
      if (this.dialog.isOpen) return;
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!target) return;
      if (target.closest(SELECTORS.EXTENSION) || target.closest(SELECTORS.ROOT)) return;

      e.preventDefault();
      e.stopPropagation();

      overlay.style.display = 'none';

      void identifyElementWithReact(target, identifyElement).then((elementInfo) => {
        this.dialog.open(
          elementInfo,
          { x: e.clientX, y: e.clientY },
          window.getSelection()?.toString() ?? undefined,
        );
      });
    };
    document.addEventListener('pointerdown', this.captureListener, { capture: true });
  }

  disableAnnotateMode(): void {
    if (this.captureListener) {
      document.removeEventListener('pointerdown', this.captureListener, { capture: true });
      this.captureListener = null;
    }
    if (this.hoverListener) {
      document.removeEventListener('pointermove', this.hoverListener);
      this.hoverListener = null;
    }
    if (this.hoverOverlay) {
      this.hoverOverlay.remove();
      this.hoverOverlay = null;
    }
    document.documentElement.style.cursor = this.savedCursor;
    this.savedCursor = '';
  }

  destroy(): void {
    this.disableAnnotateMode();
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler);
      this.escHandler = null;
    }
    if (isFrozen()) unfreeze();
    this.markerRegistry.destroy();
    this.toolbox.destroy();
    this.dialog.destroy();
    this.eventBus.removeAllListeners();
    this.restoreNavigationPatches();
  }

  private _handleGlobalEsc(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    e.preventDefault();

    // Priority 1: Close dialog if open
    if (this.dialog.isOpen) {
      this.dialog.close();
      return;
    }

    // Priority 2: Close list panel if open
    if (this.listVisible) {
      this.eventBus.emit('list-toggle', false);
      return;
    }

    // Priority 3: Exit annotate mode if active
    if (this.annotateActive) {
      this.eventBus.emit('annotate-mode', false);
      return;
    }
  }

  private _wireEventBus(): void {
    this.eventBus.on('annotate-mode', (active) => {
      this.annotateActive = active;
      if (active) {
        this.enableAnnotateMode();
      } else {
        this.disableAnnotateMode();
      }
    });

    this.eventBus.on('list-toggle', (open) => {
      this.listVisible = open;
    });

    this.eventBus.on('freeze-toggle', (frozen) => {
      if (frozen) {
        freeze();
      } else {
        unfreeze();
      }
    });

    this.eventBus.on('copy', async () => {
      const settings = await loadSettings();
      const md = generateMarkdown(this.annotations, settings.detailLevel);
      const ok = await copyToClipboard(md);
      if (ok) this.eventBus.emit('copy-success');
      console.debug('[Agentation] copy', ok ? 'success' : 'failed');
    });

    this.eventBus.on('annotation-submit', async (annotation) => {
      // Save to storage
      if (this.tabId !== null) {
        await saveAnnotation(this.tabId, this.url, annotation);
      }
      // Add/update annotation in local array
      const idx = this.annotations.findIndex((a) => a.id === annotation.id);
      if (idx >= 0) {
        this.annotations = this.annotations.map((a) => (a.id === annotation.id ? annotation : a));
      } else {
        this.annotations = [...this.annotations, annotation];
      }
      // Add marker
      this.markerRegistry.addMarker(annotation.id, document.body, { x: annotation.x, y: annotation.y });
      // Notify list panel
      this.eventBus.emit('annotations-changed', this.annotations);
      // Sync to server
      this._syncAnnotation(annotation);
    });

    this.eventBus.on('annotation-delete', async (annotationId) => {
      const ann = this.annotations.find((a) => a.id === annotationId);
      if (this.tabId !== null) {
        await deleteAnnotationFromStorage(this.tabId, this.url, annotationId);
      }
      this.annotations = this.annotations.filter((a) => a.id !== annotationId);
      this.markerRegistry.removeMarker(annotationId);
      this.eventBus.emit('annotations-changed', this.annotations);
      if (ann?.serverId) this._deleteFromServer(ann.serverId);
    });

    this.eventBus.on('marker-click', (annotationId) => {
      const ann = this.annotations.find((a) => a.id === annotationId);
      if (!ann) return;
      const elementInfo = {
        name: ann.element,
        path: ann.elementPath,
        fullPath: ann.fullPath ?? ann.elementPath,
        nearbyText: ann.nearbyText ?? '',
        cssClasses: ann.cssClasses ?? [],
        computedStyles: ann.computedStyles ?? {},
        boundingBox: ann.boundingBox ?? { x: ann.x, y: ann.y, width: 0, height: 0 },
        accessibility: ann.accessibility ?? { focusable: false },
        nearbyElements: ann.nearbyElements ?? [],
      };
      this.dialog.open(elementInfo, { x: ann.x, y: ann.y }, undefined, ann);
    });
  }

  private setupNavigationDetection(): void {
    history.pushState = (...args) => {
      this.pushStateOrig(...args);
      window.dispatchEvent(new CustomEvent('agt:navigation'));
    };
    history.replaceState = (...args) => {
      this.replaceStateOrig(...args);
      window.dispatchEvent(new CustomEvent('agt:navigation'));
    };
    window.addEventListener('popstate', this.handleNavigation);
    window.addEventListener('agt:navigation', this.handleNavigation);
  }

  private restoreNavigationPatches(): void {
    history.pushState = this.pushStateOrig;
    history.replaceState = this.replaceStateOrig;
    window.removeEventListener('popstate', this.handleNavigation);
    window.removeEventListener('agt:navigation', this.handleNavigation);
  }

  private handleNavigation = (): void => {
    if (this.annotateActive) this.disableAnnotateMode();
    this.markerRegistry.removeAll();
    this.url = window.location.href;
    this.annotations = [];
    this._loadAnnotations();
  };

  private async _initTabAndAnnotations(): Promise<void> {
    try {
      const tab = await browser.tabs.getCurrent();
      this.tabId = tab?.id ?? null;
    } catch {
      this.tabId = null;
    }
    await this._createSession();
    this._loadAnnotations();
  }

  private async _createSession(): Promise<void> {
    try {
      const domain = new URL(this.url).hostname;
      const response = await browser.runtime.sendMessage({
        type: 'CREATE_SESSION',
        requestId: crypto.randomUUID(),
        url: this.url,
        domain,
      });
      if (response?.type === 'SESSION_CREATED') {
        this.sessionId = response.session.id;
      }
    } catch {
      // Server unavailable — annotations still save locally
    }
  }

  private _syncAnnotation(annotation: Annotation): void {
    if (!this.sessionId) return;
    browser.runtime.sendMessage({
      type: 'SYNC_ANNOTATION',
      requestId: crypto.randomUUID(),
      sessionId: this.sessionId,
      annotation,
    }).then((response) => {
      if (response?.type === 'SYNC_SUCCESS') {
        // Store serverId so deletes can reference it
        const ann = this.annotations.find((a) => a.id === annotation.id);
        if (ann) ann.serverId = response.serverId;
        this.eventBus.emit('sync-status-changed', annotation.id, 'synced');
      } else {
        this.eventBus.emit('sync-status-changed', annotation.id, 'failed');
      }
    }).catch(() => {
      this.eventBus.emit('sync-status-changed', annotation.id, 'failed');
    });
  }

  private _deleteFromServer(serverId: string): void {
    if (!this.sessionId) return;
    browser.runtime.sendMessage({
      type: 'DELETE_ANNOTATION',
      requestId: crypto.randomUUID(),
      serverId,
    }).catch(() => {});
  }

  private _loadAnnotations(): void {
    if (this.tabId === null) return;
    loadAnnotations(this.tabId, this.url).then((anns) => {
      this.annotations = anns;
      this.eventBus.emit('annotations-changed', anns);
      // Recreate markers for loaded annotations
      for (const ann of anns) {
        this.markerRegistry.addMarker(ann.id, document.body, { x: ann.x, y: ann.y });
      }
    }).catch(console.error);
  }
}
