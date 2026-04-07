import type { EventEmitter } from '../../lib/event-emitter';

const MARKER_CSS = `
.agt-marker {
  position: fixed;
  left: 0;
  top: 0;
  transform: translate(var(--agt-x), var(--agt-y)) translate(-50%, -50%);
  will-change: transform;
  z-index: 2147483646;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: #7c6aef;
  border: 2px solid rgba(255,255,255,0.9);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(124,106,239,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
}
.agt-marker--detached {
  opacity: 0.4;
  border-style: dashed;
}
.agt-marker[data-status="synced"]::after { content: '✓'; color: #fff; font-size: 10px; font-family: system-ui, sans-serif; }
.agt-marker[data-status="failed"]::after { content: '!'; color: #fff; font-size: 11px; font-weight: 700; font-family: system-ui, sans-serif; }
.agt-marker[data-status="pending"]::after { content: '·'; color: rgba(255,255,255,0.8); font-size: 16px; font-family: system-ui, sans-serif; }
`;

interface MarkerEntry {
  element: Element;
  markerEl: HTMLElement;
}

export class MarkerRegistry {
  private markers = new Map<string, MarkerEntry>();
  private elementToAnnotation = new Map<Element, string>();
  private observer: ResizeObserver;
  private mutationObserver: MutationObserver;
  private positionUpdateScheduled = false;
  private styleEl: HTMLStyleElement;
  private eventBus: EventEmitter;

  constructor(eventBus: EventEmitter) {
    this.eventBus = eventBus;

    this.styleEl = document.createElement('style');
    this.styleEl.id = 'agt-marker-styles';
    this.styleEl.textContent = MARKER_CSS;
    document.head.appendChild(this.styleEl);

    this.observer = new ResizeObserver(() => this.schedulePositionUpdate());

    window.addEventListener('scroll', this.onScroll, { passive: true });

    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          if (node instanceof Element) {
            for (const [element, annotationId] of this.elementToAnnotation) {
              if (node === element || node.contains(element)) {
                this.setMarkerDetached(annotationId);
              }
            }
          }
        }
      }
    });
    this.mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  addMarker(annotationId: string, element: Element, position: { x: number; y: number }): void {
    const markerEl = document.createElement('div');
    markerEl.setAttribute('data-agt-marker', annotationId);
    markerEl.className = 'agt-marker';
    markerEl.style.setProperty('--agt-x', `${position.x}px`);
    markerEl.style.setProperty('--agt-y', `${position.y}px`);

    markerEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.eventBus.emit('marker-click', annotationId);
    });

    document.body.appendChild(markerEl);
    this.markers.set(annotationId, { element, markerEl });
    this.elementToAnnotation.set(element, annotationId);
    this.observer.observe(element);
  }

  removeMarker(annotationId: string): void {
    const entry = this.markers.get(annotationId);
    if (!entry) return;

    entry.markerEl.remove();
    this.markers.delete(annotationId);

    // Only unobserve non-shared elements.
    // All markers currently share document.body — don't unobserve it
    // since other markers still need resize tracking.
    if (entry.element !== document.body) {
      this.observer.unobserve(entry.element);
      this.elementToAnnotation.delete(entry.element);
    }
  }

  removeAll(): void {
    for (const { element, markerEl } of this.markers.values()) {
      markerEl.remove();
      this.observer.unobserve(element);
    }
    this.markers.clear();
    this.elementToAnnotation.clear();
  }

  destroy(): void {
    this.removeAll();
    this.observer.disconnect();
    this.mutationObserver.disconnect();
    window.removeEventListener('scroll', this.onScroll);
    this.styleEl.remove();
  }

  private onScroll = (): void => {
    this.schedulePositionUpdate();
  };

  private schedulePositionUpdate(): void {
    if (this.positionUpdateScheduled) return;
    this.positionUpdateScheduled = true;
    requestAnimationFrame(() => {
      this.positionUpdateScheduled = false;
      this.updateAllMarkerPositions();
    });
  }

  private updateAllMarkerPositions(): void {
    for (const { element, markerEl } of this.markers.values()) {
      const rect = element.getBoundingClientRect();
      markerEl.style.setProperty('--agt-x', `${rect.left + rect.width / 2}px`);
      markerEl.style.setProperty('--agt-y', `${rect.top + rect.height / 2}px`);
    }
  }

  private setMarkerDetached(annotationId: string): void {
    const entry = this.markers.get(annotationId);
    if (entry) entry.markerEl.classList.add('agt-marker--detached');
  }
}
