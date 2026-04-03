import { EventEmitter } from './event-emitter';
import { identifyElement } from './element-identification';
import { Toolbar } from '../ui/toolbar/Toolbar';
import { MarkerRegistry } from '../ui/markers/MarkerRegistry';
import { SELECTORS } from './constants';
import type { Annotation } from './types';

export class AgentationApp {
  private eventBus: EventEmitter;
  private toolbar: Toolbar;
  private markerRegistry: MarkerRegistry;
  private url: string;
  private annotations: Annotation[] = [];
  private captureListener: ((e: PointerEvent) => void) | null = null;
  private pushStateOrig: typeof history.pushState;
  private replaceStateOrig: typeof history.replaceState;

  constructor(container: HTMLElement, _shadow: ShadowRoot) {
    this.eventBus = new EventEmitter();
    this.url = window.location.href;

    this.markerRegistry = new MarkerRegistry(this.eventBus);
    this.toolbar = new Toolbar(container, this.eventBus);

    this.eventBus.on('annotate-mode', (active) => {
      if (active) {
        this.enableAnnotateMode();
      } else {
        this.disableAnnotateMode();
      }
    });

    this.pushStateOrig = history.pushState.bind(history);
    this.replaceStateOrig = history.replaceState.bind(history);
    this.setupNavigationDetection();

    // Restore markers on next frame (avoid Shadow DOM timing race)
    requestAnimationFrame(() => this.loadAnnotations());
  }

  enableAnnotateMode(): void {
    if (this.captureListener) return; // already enabled
    this.captureListener = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(SELECTORS.EXTENSION) || target.closest(SELECTORS.ROOT)) return;

      e.preventDefault();
      e.stopPropagation();

      const elementInfo = identifyElement(target);
      console.debug('[Agentation] element identified:', elementInfo);
    };
    document.addEventListener('pointerdown', this.captureListener, { capture: true });
  }

  disableAnnotateMode(): void {
    if (!this.captureListener) return;
    document.removeEventListener('pointerdown', this.captureListener, { capture: true });
    this.captureListener = null;
  }

  destroy(): void {
    this.disableAnnotateMode();
    this.markerRegistry.destroy();
    this.toolbar.destroy();
    this.eventBus.removeAllListeners();
    this.restoreNavigationPatches();
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
    this.loadAnnotations();
  };

  private loadAnnotations(): void {
    // Phase 3: load from storage and create markers
    // For now: no-op — annotations come via background messages
    void this.url; // suppress unused warning
  }
}
