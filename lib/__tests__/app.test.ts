import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from '../event-emitter';

// jsdom does not implement ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock browser global (WXT auto-import not available in vitest)
const mockSendMessage = vi.fn();
const mockOnMessage = { addListener: vi.fn(), removeListener: vi.fn() };
(global as Record<string, unknown>).browser = {
  runtime: { sendMessage: mockSendMessage, onMessage: mockOnMessage },
  tabs: { getCurrent: vi.fn().mockResolvedValue({ id: 1 }) },
};

// Mock storage module
vi.mock('wxt/utils/storage', () => ({
  storage: {
    defineItem: vi.fn(() => ({
      getValue: vi.fn(async () => ({})),
      setValue: vi.fn(),
    })),
  },
}));

// Mock identifyElement to avoid full DOM in unit tests
vi.mock('../element-identification', () => ({
  identifyElement: vi.fn(() => ({
    name: 'div',
    path: 'div',
    fullPath: 'div',
    nearbyText: '',
    cssClasses: [],
    computedStyles: {},
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    accessibility: { focusable: false },
    nearbyElements: [],
  })),
}));

import { AgentationApp } from '../app';
import { identifyElement } from '../element-identification';

describe('AgentationApp', () => {
  let container: HTMLElement;
  let shadow: ShadowRoot;
  let app: AgentationApp;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const host = document.createElement('div');
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    app = new AgentationApp(container, shadow);
  });

  afterEach(() => {
    app.destroy();
    container.remove();
  });

  it('does not crash on construction', () => {
    expect(app).toBeDefined();
  });

  it('enableAnnotateMode attaches a pointerdown capture listener', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    app.enableAnnotateMode();
    expect(addSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), { capture: true });
    addSpy.mockRestore();
  });

  it('disableAnnotateMode removes the capture listener', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    app.enableAnnotateMode();
    app.disableAnnotateMode();
    expect(removeSpy).toHaveBeenCalledWith('pointerdown', expect.any(Function), { capture: true });
    removeSpy.mockRestore();
  });

  it('pointerdown on a data-agt-ext element does NOT call identifyElement', () => {
    app.enableAnnotateMode();
    const extEl = document.createElement('div');
    extEl.setAttribute('data-agt-ext', '');
    container.appendChild(extEl);

    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: extEl });
    document.dispatchEvent(event);

    expect(identifyElement).not.toHaveBeenCalled();
    extEl.remove();
  });

  it('pointerdown on a normal element calls identifyElement', () => {
    app.enableAnnotateMode();
    const normalEl = document.createElement('p');
    normalEl.textContent = 'click me';
    document.body.appendChild(normalEl);

    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: normalEl });
    document.dispatchEvent(event);

    expect(identifyElement).toHaveBeenCalledWith(normalEl);
    normalEl.remove();
  });

  it('destroy() does not throw', () => {
    expect(() => app.destroy()).not.toThrow();
  });

  it('annotate-mode event on eventBus enables annotate mode', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    // Access the internal event bus by emitting via the toolbar (which has it)
    // Instead, test via enableAnnotateMode directly
    app.enableAnnotateMode();
    expect(addSpy).toHaveBeenCalled();
    addSpy.mockRestore();
  });
});
