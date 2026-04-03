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
  border-radius: 50%;
  background: var(--agt-accent, #e94560);
  border: 2px solid white;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.4);
}
.agt-marker--detached {
  opacity: 0.4;
  border-style: dashed;
}
.agt-marker[data-status="synced"]::after { content: '✓'; color: #2ed573; font-size: 10px; }
.agt-marker[data-status="failed"]::after { content: '●'; color: #ff4757; font-size: 10px; }
.agt-marker[data-status="pending"]::after { content: '○'; color: #ffa502; font-size: 10px; }
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
