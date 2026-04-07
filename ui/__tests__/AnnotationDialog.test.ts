import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from '../../lib/event-emitter';
import { AnnotationDialog } from '../dialog/AnnotationDialog';
import type { ElementInfo } from '../../lib/element-identification';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeElementInfo(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    name: 'button: Submit',
    path: 'form > button',
    fullPath: 'html > body > form > button',
    nearbyText: 'nearby',
    cssClasses: ['btn'],
    computedStyles: { color: 'black' },
    boundingBox: { x: 100, y: 200, width: 80, height: 40 },
    accessibility: { focusable: true },
    nearbyElements: [],
    ...overrides,
  };
}

function makeEnv() {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const eventBus = new EventEmitter();
  const dialog = new AnnotationDialog(parent, eventBus);
  return { parent, eventBus, dialog };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnnotationDialog', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    env.dialog.destroy();
    env.parent.remove();
  });

  it('constructs without throwing', () => {
    expect(env.dialog).toBeDefined();
  });

  it('dialog is hidden by default', () => {
    const { parent } = env;
    const dialogEl = parent.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogEl).not.toBeNull();
    expect(dialogEl.hidden).toBe(true);
  });

  it('dialog has role="dialog", aria-modal="true", aria-labelledby', () => {
    const { parent } = env;
    const dialogEl = parent.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogEl.getAttribute('aria-modal')).toBe('true');
    expect(dialogEl.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('open() makes dialog visible', () => {
    const { parent, dialog } = env;
    dialog.open(makeElementInfo(), { x: 200, y: 300 });
    const dialogEl = parent.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogEl.hidden).toBe(false);
  });

  it('open() shows element name in title', () => {
    const { parent, dialog } = env;
    dialog.open(makeElementInfo({ name: 'button: Login' }), { x: 0, y: 0 });
    expect(parent.textContent).toContain('button: Login');
  });

  it('open() shows DOM path', () => {
    const { parent, dialog } = env;
    dialog.open(makeElementInfo({ path: 'form > button.submit' }), { x: 0, y: 0 });
    expect(parent.textContent).toContain('form > button.submit');
  });

  it('open() pre-fills selectedText in textarea if provided', () => {
    const { parent, dialog } = env;
    dialog.open(makeElementInfo(), { x: 0, y: 0 }, 'selected passage');
    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('selected passage');
  });

  it('open() does not pre-fill textarea when no selectedText', () => {
    const { parent, dialog } = env;
    dialog.open(makeElementInfo(), { x: 0, y: 0 });
    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  it('close() hides the dialog', () => {
    const { parent, dialog } = env;
    dialog.open(makeElementInfo(), { x: 0, y: 0 });
    dialog.close();
    const dialogEl = parent.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogEl.hidden).toBe(true);
  });

  it('close() emits popup-close event', () => {
    const { dialog, eventBus } = env;
    const fn = vi.fn();
    eventBus.on('popup-close', fn);
    dialog.open(makeElementInfo(), { x: 0, y: 0 });
    dialog.close();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Escape key closes the dialog', () => {
    const { parent, dialog } = env;
    dialog.open(makeElementInfo(), { x: 0, y: 0 });
    const dialogEl = parent.querySelector('[role="dialog"]') as HTMLElement;
    dialogEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dialogEl.hidden).toBe(true);
  });

  it('submitting with non-empty text emits annotation-submit', () => {
    const { parent, dialog, eventBus } = env;
    const fn = vi.fn();
    eventBus.on('annotation-submit', fn);

    dialog.open(makeElementInfo(), { x: 100, y: 200 });
    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'This is broken';
    const submitBtn = parent.querySelector('button[data-action="submit"]') as HTMLButtonElement;
    submitBtn.click();

    expect(fn).toHaveBeenCalledTimes(1);
    const annotation = fn.mock.calls[0][0];
    expect(annotation.comment).toBe('This is broken');
    expect(annotation.element).toBe('button: Submit');
    expect(annotation.id).toBeTruthy();
  });

  it('submitting with empty text does NOT emit annotation-submit', () => {
    const { parent, dialog, eventBus } = env;
    const fn = vi.fn();
    eventBus.on('annotation-submit', fn);

    dialog.open(makeElementInfo(), { x: 0, y: 0 });
    const submitBtn = parent.querySelector('button[data-action="submit"]') as HTMLButtonElement;
    submitBtn.click();

    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel button closes dialog without submitting', () => {
    const { parent, dialog, eventBus } = env;
    const fn = vi.fn();
    eventBus.on('annotation-submit', fn);

    dialog.open(makeElementInfo(), { x: 0, y: 0 });
    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'some text';
    const cancelBtn = parent.querySelector('button[data-action="cancel"]') as HTMLButtonElement;
    cancelBtn.click();

    expect(fn).not.toHaveBeenCalled();
    const dialogEl = parent.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogEl.hidden).toBe(true);
  });

  it('destroy() removes dialog element from DOM', () => {
    const { parent, dialog } = env;
    dialog.destroy();
    expect(parent.querySelector('[role="dialog"]')).toBeNull();
  });

  it('open() in edit mode shows delete button', () => {
    const { parent, dialog } = env;
    const existingAnnotation = {
      id: 'ann-1',
      comment: 'existing comment',
      element: 'button: Submit',
      elementPath: 'form > button',
      x: 100,
      y: 200,
      timestamp: Date.now(),
    };
    dialog.open(makeElementInfo(), { x: 0, y: 0 }, undefined, existingAnnotation);
    const deleteBtn = parent.querySelector('button[data-action="delete"]');
    expect(deleteBtn).not.toBeNull();
  });

  it('delete button emits annotation-delete with annotationId', () => {
    const { parent, dialog, eventBus } = env;
    const fn = vi.fn();
    eventBus.on('annotation-delete', fn);

    const existingAnnotation = {
      id: 'ann-delete-test',
      comment: 'old comment',
      element: 'button: Submit',
      elementPath: 'form > button',
      x: 100,
      y: 200,
      timestamp: Date.now(),
    };
    dialog.open(makeElementInfo(), { x: 0, y: 0 }, undefined, existingAnnotation);
    const deleteBtn = parent.querySelector('button[data-action="delete"]') as HTMLButtonElement;
    deleteBtn.click();

    expect(fn).toHaveBeenCalledWith('ann-delete-test');
  });

  it('open() in edit mode pre-fills textarea with existing comment', () => {
    const { parent, dialog } = env;
    const existingAnnotation = {
      id: 'ann-1',
      comment: 'pre-existing comment',
      element: 'button: Submit',
      elementPath: 'form > button',
      x: 100,
      y: 200,
      timestamp: Date.now(),
    };
    dialog.open(makeElementInfo(), { x: 0, y: 0 }, undefined, existingAnnotation);
    const textarea = parent.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('pre-existing comment');
  });
});
