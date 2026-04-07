import { EventEmitter } from './event-emitter';
import { identifyElement } from './element-identification';
import { identifyElementWithReact } from './react-detection';
import { Toolbar } from '../ui/toolbar/Toolbar';
import { MarkerRegistry } from '../ui/markers/MarkerRegistry';
import { AnnotationDialog } from '../ui/dialog/AnnotationDialog';
import { AnnotationList } from '../ui/list/AnnotationList';
import { generateMarkdown, copyToClipboard } from './generate-output';
import { freeze, unfreeze, isFrozen } from './freeze-animations';
import { saveAnnotation, loadAnnotations, deleteAnnotation as deleteAnnotationFromStorage, loadSettings } from './storage';
import { SELECTORS } from './constants';
import type { Annotation } from './types';

export class AgentationApp {
  private eventBus: EventEmitter;
  private toolbar: Toolbar;
  private markerRegistry: MarkerRegistry;
  private dialog: AnnotationDialog;
  private annotationList: AnnotationList;
  private url: string;
  private annotations: Annotation[] = [];
  private tabId: number | null = null;
  private captureListener: ((e: PointerEvent) => void) | null = null;
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
    this.toolbar = new Toolbar(container, this.eventBus);
    this.dialog = new AnnotationDialog(container, this.eventBus);
    this.annotationList = new AnnotationList(container, this.eventBus);

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
    document.documentElement.style.cursor = 'crosshair';
    this.captureListener = async (e: PointerEvent) => {
      // Don't capture clicks while dialog is open
      if (this.dialog.isOpen) return;

      const target = e.target as HTMLElement;
      if (target.closest(SELECTORS.EXTENSION) || target.closest(SELECTORS.ROOT)) return;

      e.preventDefault();
      e.stopPropagation();

      const elementInfo = await identifyElementWithReact(target, identifyElement);
      const position = { x: e.clientX, y: e.clientY };
      this.dialog.open(
        elementInfo,
        position,
        window.getSelection()?.toString() ?? undefined,
      );
    };
    document.addEventListener('pointerdown', this.captureListener, { capture: true });
  }

  disableAnnotateMode(): void {
    if (!this.captureListener) return;
    document.removeEventListener('pointerdown', this.captureListener, { capture: true });
    this.captureListener = null;
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
    this.toolbar.destroy();
    this.dialog.destroy();
    this.annotationList.destroy();
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
      this.annotationList.toggle(open);
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
    });

    this.eventBus.on('annotation-delete', async (annotationId) => {
      if (this.tabId !== null) {
        await deleteAnnotationFromStorage(this.tabId, this.url, annotationId);
      }
      this.annotations = this.annotations.filter((a) => a.id !== annotationId);
      this.eventBus.emit('annotations-changed', this.annotations);
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
    this._loadAnnotations();
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
