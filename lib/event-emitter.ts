import type { Annotation, AnnotationSyncStatus } from './types';

type EventMap = {
  'annotate-mode': [active: boolean];
  'list-toggle': [open: boolean];
  'freeze-toggle': [frozen: boolean];
  'copy': [markdown: string];
  'copy-success': [];
  'annotation-submit': [annotation: Annotation];
  'annotation-delete': [annotationId: string];
  'annotation-update': [annotation: Annotation];
  'popup-close': [];
  'marker-click': [annotationId: string];
  'annotations-changed': [annotations: Annotation[]];
  'sync-status-changed': [annotationId: string, status: AnnotationSyncStatus];
  'server-status-changed': [status: 'connected' | 'disconnected' | 'unknown'];
};

type Listener<K extends keyof EventMap> = (...args: EventMap[K]) => void;

export class EventEmitter {
  private listeners = new Map<string, Set<Function>>();

  on<K extends keyof EventMap>(event: K, fn: Listener<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
    return () => this.off(event, fn);
  }

  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): void {
    const fns = this.listeners.get(event);
    if (!fns) return;
    for (const fn of fns) {
      fn(...args);
    }
  }

  off<K extends keyof EventMap>(event: K, fn: Function): void {
    this.listeners.get(event)?.delete(fn);
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
