import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from '../../lib/event-emitter';
import { Toolbar } from '../toolbar/Toolbar';

function makeEnv() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const eventBus = new EventEmitter();
  const toolbar = new Toolbar(container, eventBus);
  return { container, eventBus, toolbar };
}

describe('Toolbar', () => {
  it('renders a toolbar with role="toolbar" and aria-label', () => {
    const { container, toolbar } = makeEnv();
    const el = container.querySelector('[role="toolbar"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('aria-label')).toBeTruthy();
    toolbar.destroy();
  });

  it('renders exactly 6 buttons', () => {
    const { container, toolbar } = makeEnv();
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(6);
    toolbar.destroy();
  });

  it('each button has an aria-label', () => {
    const { container, toolbar } = makeEnv();
    const buttons = container.querySelectorAll('button');
    buttons.forEach((btn) => {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });
    toolbar.destroy();
  });

  it('clicking annotate button emits annotate-mode true', () => {
    const { container, eventBus, toolbar } = makeEnv();
    const fn = vi.fn();
    eventBus.on('annotate-mode', fn);
    const annotateBtn = container.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    annotateBtn.click();
    expect(fn).toHaveBeenCalledWith(true);
    toolbar.destroy();
  });

  it('clicking annotate button again emits annotate-mode false', () => {
    const { container, eventBus, toolbar } = makeEnv();
    const fn = vi.fn();
    eventBus.on('annotate-mode', fn);
    const annotateBtn = container.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    annotateBtn.click();
    annotateBtn.click();
    expect(fn).toHaveBeenNthCalledWith(1, true);
    expect(fn).toHaveBeenNthCalledWith(2, false);
    toolbar.destroy();
  });

  it('annotate button gets aria-pressed="true" when active', () => {
    const { container, eventBus, toolbar } = makeEnv();
    const annotateBtn = container.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    annotateBtn.click();
    expect(annotateBtn.getAttribute('aria-pressed')).toBe('true');
    toolbar.destroy();
  });

  it('annotate button gets aria-pressed="false" when deactivated', () => {
    const { container, eventBus, toolbar } = makeEnv();
    const annotateBtn = container.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    annotateBtn.click(); // on
    annotateBtn.click(); // off
    expect(annotateBtn.getAttribute('aria-pressed')).toBe('false');
    toolbar.destroy();
  });

  it('destroy() removes the toolbar from DOM', () => {
    const { container, toolbar } = makeEnv();
    expect(container.querySelector('[role="toolbar"]')).not.toBeNull();
    toolbar.destroy();
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('receives annotate-mode event from eventBus and updates aria-pressed', () => {
    const { container, eventBus, toolbar } = makeEnv();
    const annotateBtn = container.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    eventBus.emit('annotate-mode', true);
    expect(annotateBtn.getAttribute('aria-pressed')).toBe('true');
    eventBus.emit('annotate-mode', false);
    expect(annotateBtn.getAttribute('aria-pressed')).toBe('false');
    toolbar.destroy();
  });
});
