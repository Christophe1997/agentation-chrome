import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from '../../lib/event-emitter';
import { MarkerRegistry } from '../markers/MarkerRegistry';

// jsdom does not implement ResizeObserver or MutationObserver fully
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

describe('MarkerRegistry', () => {
  let eventBus: EventEmitter;
  let registry: MarkerRegistry;
  let target: HTMLElement;

  beforeEach(() => {
    eventBus = new EventEmitter();
    registry = new MarkerRegistry(eventBus);
    target = document.createElement('div');
    target.textContent = 'target';
    document.body.appendChild(target);
  });

  afterEach(() => {
    registry.destroy();
    target.remove();
  });

  it('addMarker appends an element with data-agt-marker attribute', () => {
    registry.addMarker('ann-1', target, { x: 100, y: 200 });
    const marker = document.querySelector('[data-agt-marker="ann-1"]');
    expect(marker).not.toBeNull();
  });

  it('addMarker sets --agt-x and --agt-y CSS custom properties', () => {
    registry.addMarker('ann-1', target, { x: 100, y: 200 });
    const marker = document.querySelector('[data-agt-marker="ann-1"]') as HTMLElement;
    expect(marker.style.getPropertyValue('--agt-x')).toBe('100px');
    expect(marker.style.getPropertyValue('--agt-y')).toBe('200px');
  });

  it('clicking marker emits marker-click with annotationId', () => {
    const fn = vi.fn();
    eventBus.on('marker-click', fn);
    registry.addMarker('ann-2', target, { x: 0, y: 0 });
    const marker = document.querySelector('[data-agt-marker="ann-2"]') as HTMLElement;
    marker.click();
    expect(fn).toHaveBeenCalledWith('ann-2');
  });

  it('removeAll removes all marker elements from DOM', () => {
    registry.addMarker('ann-1', target, { x: 0, y: 0 });
    registry.addMarker('ann-2', target, { x: 10, y: 10 });
    registry.removeAll();
    expect(document.querySelectorAll('[data-agt-marker]').length).toBe(0);
  });

  it('injects a style element into document.head', () => {
    expect(document.getElementById('agt-marker-styles')).not.toBeNull();
  });

  it('destroy removes the style element', () => {
    registry.destroy();
    expect(document.getElementById('agt-marker-styles')).toBeNull();
    // Recreate for afterEach to not fail
    registry = new MarkerRegistry(eventBus);
  });

  it('destroy removes all markers from DOM', () => {
    registry.addMarker('ann-1', target, { x: 0, y: 0 });
    registry.destroy();
    expect(document.querySelectorAll('[data-agt-marker]').length).toBe(0);
    registry = new MarkerRegistry(eventBus);
  });

  it('element removed from DOM gives marker the detached class', async () => {
    // MutationObserver is async — we use a small wait
    const tracked = document.createElement('div');
    document.body.appendChild(tracked);
    registry.addMarker('ann-detach', tracked, { x: 0, y: 0 });

    tracked.remove();

    // Allow MutationObserver microtask to fire
    await new Promise((r) => setTimeout(r, 0));

    const marker = document.querySelector('[data-agt-marker="ann-detach"]') as HTMLElement;
    expect(marker.classList.contains('agt-marker--detached')).toBe(true);
  });
});
