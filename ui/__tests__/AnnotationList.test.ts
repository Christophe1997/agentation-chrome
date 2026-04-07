import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from '../../lib/event-emitter';
import { AnnotationList } from '../list/AnnotationList';
import type { Annotation } from '../../lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: `ann-${Math.random().toString(36).slice(2)}`,
    x: 100,
    y: 200,
    comment: 'Test comment',
    element: 'button: Submit',
    elementPath: 'form > button',
    timestamp: Date.now(),
    status: 'pending',
    ...overrides,
  };
}

function makeEnv() {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const eventBus = new EventEmitter();
  const list = new AnnotationList(parent, eventBus);
  return { parent, eventBus, list };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnnotationList', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    env.list.destroy();
    env.parent.remove();
  });

  it('constructs without throwing', () => {
    expect(env.list).toBeDefined();
  });

  it('panel is hidden by default', () => {
    const { parent } = env;
    const panel = parent.querySelector('[role="listbox"]') as HTMLElement;
    expect(panel.hidden).toBe(true);
  });

  it('toggle(true) shows panel', () => {
    const { parent, list } = env;
    list.toggle(true);
    const panel = parent.querySelector('[role="listbox"]') as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute('aria-hidden')).toBe('false');
  });

  it('toggle(false) hides panel', () => {
    const { parent, list } = env;
    list.toggle(true);
    list.toggle(false);
    const panel = parent.querySelector('[role="listbox"]') as HTMLElement;
    expect(panel.hidden).toBe(true);
    expect(panel.getAttribute('aria-hidden')).toBe('true');
  });

  it('annotations-changed event renders rows', () => {
    const { parent, eventBus } = env;
    const anns = [
      makeAnnotation({ id: 'a1', comment: 'First issue' }),
      makeAnnotation({ id: 'a2', comment: 'Second issue' }),
    ];
    eventBus.emit('annotations-changed', anns);

    const rows = parent.querySelectorAll('[role="option"]');
    expect(rows.length).toBe(2);
  });

  it('each row shows comment preview (max 80 chars)', () => {
    const { parent, eventBus } = env;
    const long = 'A'.repeat(100);
    eventBus.emit('annotations-changed', [makeAnnotation({ comment: long })]);

    const row = parent.querySelector('[role="option"]') as HTMLElement;
    const preview = row.querySelector('.agt-list-comment') as HTMLElement;
    expect(preview.textContent!.length).toBeLessThanOrEqual(83); // 80 chars + possible '...'
  });

  it('each row shows element name', () => {
    const { parent, eventBus } = env;
    eventBus.emit('annotations-changed', [makeAnnotation({ element: 'input[type="email"]' })]);
    const row = parent.querySelector('[role="option"]') as HTMLElement;
    expect(row.textContent).toContain('input[type="email"]');
  });

  it('each row has a status badge', () => {
    const { parent, eventBus } = env;
    eventBus.emit('annotations-changed', [makeAnnotation({ status: 'pending' })]);
    const badge = parent.querySelector('.agt-list-status') as HTMLElement;
    expect(badge).not.toBeNull();
  });

  it('delete button per row emits annotation-delete', () => {
    const { parent, eventBus } = env;
    const fn = vi.fn();
    eventBus.on('annotation-delete', fn);

    const ann = makeAnnotation({ id: 'del-test' });
    eventBus.emit('annotations-changed', [ann]);

    const deleteBtn = parent.querySelector('button[data-action="delete-row"]') as HTMLButtonElement;
    deleteBtn.click();

    expect(fn).toHaveBeenCalledWith('del-test');
  });

  it('sync-status-changed event updates status badge', () => {
    const { parent, eventBus } = env;
    const ann = makeAnnotation({ id: 'sync-test' });
    eventBus.emit('annotations-changed', [ann]);

    eventBus.emit('sync-status-changed', 'sync-test', 'synced');

    const badge = parent.querySelector('[data-annotation-id="sync-test"] .agt-list-status') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.getAttribute('data-status')).toBe('synced');
  });

  it('annotations-changed with empty array renders empty state', () => {
    const { parent, eventBus } = env;
    eventBus.emit('annotations-changed', [makeAnnotation()]);
    eventBus.emit('annotations-changed', []);

    const rows = parent.querySelectorAll('[role="option"]');
    expect(rows.length).toBe(0);
  });

  it('clear-all button appears when there are annotations', () => {
    const { parent, eventBus } = env;
    eventBus.emit('annotations-changed', [makeAnnotation()]);
    const clearBtn = parent.querySelector('button[data-action="clear-all"]');
    expect(clearBtn).not.toBeNull();
  });

  it('clear-all button emits clear-all event after confirm', () => {
    const { parent, eventBus } = env;
    // Stub window.confirm to return true
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const fn = vi.fn();
    // We'll verify clear-all via annotation-delete or a dedicated event
    // The plan says emit 'clear-all' — let's listen on eventBus
    // For now use a custom approach: listen to 'annotations-changed' with empty array
    // Actually per plan: emit 'clear-all'
    // AnnotationList should emit via eventBus - but 'clear-all' is not in EventMap.
    // We'll verify by checking that annotation-delete is emitted for each annotation.
    eventBus.on('annotation-delete', fn);
    const anns = [makeAnnotation({ id: 'c1' }), makeAnnotation({ id: 'c2' })];
    eventBus.emit('annotations-changed', anns);

    const clearBtn = parent.querySelector('button[data-action="clear-all"]') as HTMLButtonElement;
    clearBtn.click();

    expect(fn).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  it('clear-all does NOT emit when confirm is cancelled', () => {
    const { parent, eventBus } = env;
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fn = vi.fn();
    eventBus.on('annotation-delete', fn);

    eventBus.emit('annotations-changed', [makeAnnotation()]);
    const clearBtn = parent.querySelector('button[data-action="clear-all"]') as HTMLButtonElement;
    clearBtn.click();

    expect(fn).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('destroy() removes panel from DOM', () => {
    const { parent, list } = env;
    list.destroy();
    expect(parent.querySelector('[role="listbox"]')).toBeNull();
  });
});
