import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from '../../lib/event-emitter';
import { Toolbox } from '../toolbox/Toolbox';
import type { Annotation } from '../../lib/types';

// ── Helpers ───────────────────────────────────────────────────────────────

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
  const container = document.createElement('div');
  document.body.appendChild(container);
  const eventBus = new EventEmitter();
  const toolbox = new Toolbox(container, eventBus);
  return { container, eventBus, toolbox };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Toolbox', () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    env = makeEnv();
  });

  afterEach(() => {
    env.toolbox.destroy();
    env.container.remove();
  });

  // ── Container structure ──

  it('renders with role="toolbar" and aria-label', () => {
    const el = env.container.querySelector('[role="toolbar"]');
    expect(el).not.toBeNull();
    expect(el!.getAttribute('aria-label')).toBeTruthy();
  });

  it('renders exactly 5 buttons in the header', () => {
    const buttons = env.container.querySelectorAll('.agt-toolbox-header button');
    expect(buttons.length).toBe(5);
  });

  it('each button has an aria-label', () => {
    const buttons = env.container.querySelectorAll('.agt-toolbox-header button');
    buttons.forEach((btn) => {
      expect(btn.getAttribute('aria-label')).toBeTruthy();
    });
  });

  it('has data-agt-theme attribute set to "dark" or "light"', () => {
    const theme = env.container.querySelector('.agt-toolbox')!.getAttribute('data-agt-theme');
    expect(['dark', 'light']).toContain(theme);
  });

  // ── Annotate toggle ──

  it('clicking annotate button emits annotate-mode true', () => {
    const fn = vi.fn();
    env.eventBus.on('annotate-mode', fn);
    const btn = env.container.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    btn.click();
    expect(fn).toHaveBeenCalledWith(true);
  });

  it('clicking annotate button again emits annotate-mode false', () => {
    const fn = vi.fn();
    env.eventBus.on('annotate-mode', fn);
    const btn = env.container.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    btn.click();
    btn.click();
    expect(fn).toHaveBeenNthCalledWith(1, true);
    expect(fn).toHaveBeenNthCalledWith(2, false);
  });

  it('annotate button gets aria-pressed="true" when active', () => {
    const btn = env.container.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('receives annotate-mode event from eventBus and updates aria-pressed', () => {
    const btn = env.container.querySelector('[aria-label="Annotate"]') as HTMLButtonElement;
    env.eventBus.emit('annotate-mode', true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    env.eventBus.emit('annotate-mode', false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  // ── List toggle ──

  it('starts with list expanded by default', () => {
    expect(env.container.querySelector('.agt-toolbox')!.classList.contains('agt-toolbox--expanded')).toBe(true);
  });

  it('clicking list button toggles expanded state off', () => {
    const btn = env.container.querySelector('[aria-label="List Annotations"]') as HTMLButtonElement;
    btn.click();
    expect(env.container.querySelector('.agt-toolbox')!.classList.contains('agt-toolbox--expanded')).toBe(false);
  });

  it('clicking list button emits list-toggle false (collapsing from default expanded)', () => {
    const fn = vi.fn();
    env.eventBus.on('list-toggle', fn);
    const btn = env.container.querySelector('[aria-label="List Annotations"]') as HTMLButtonElement;
    btn.click();
    expect(fn).toHaveBeenCalledWith(false);
  });

  it('receives list-toggle event and updates expanded state', () => {
    env.eventBus.emit('list-toggle', false);
    expect(env.container.querySelector('.agt-toolbox')!.classList.contains('agt-toolbox--expanded')).toBe(false);
    env.eventBus.emit('list-toggle', true);
    expect(env.container.querySelector('.agt-toolbox')!.classList.contains('agt-toolbox--expanded')).toBe(true);
  });

  // ── Annotation list rendering ──

  it('annotations-changed event renders cards', () => {
    const anns = [
      makeAnnotation({ id: 'a1', comment: 'First issue' }),
      makeAnnotation({ id: 'a2', comment: 'Second issue' }),
    ];
    env.eventBus.emit('annotations-changed', anns);
    const cards = env.container.querySelectorAll('.agt-toolbox-card');
    expect(cards.length).toBe(2);
  });

  it('each card shows comment preview (max 80 chars)', () => {
    const long = 'A'.repeat(100);
    env.eventBus.emit('annotations-changed', [makeAnnotation({ comment: long })]);
    const preview = env.container.querySelector('.agt-toolbox-comment') as HTMLElement;
    expect(preview.textContent!.length).toBeLessThanOrEqual(83);
  });

  it('each card shows element name', () => {
    env.eventBus.emit('annotations-changed', [makeAnnotation({ element: 'input[type="email"]' })]);
    const card = env.container.querySelector('.agt-toolbox-card') as HTMLElement;
    expect(card.textContent).toContain('input[type="email"]');
  });

  it('each card has a status badge', () => {
    env.eventBus.emit('annotations-changed', [makeAnnotation({ status: 'pending' })]);
    const badge = env.container.querySelector('.agt-toolbox-status') as HTMLElement;
    expect(badge).not.toBeNull();
  });

  it('delete button emits annotation-delete', () => {
    const fn = vi.fn();
    env.eventBus.on('annotation-delete', fn);
    const ann = makeAnnotation({ id: 'del-test' });
    env.eventBus.emit('annotations-changed', [ann]);
    const deleteBtn = env.container.querySelector('button[data-action="delete-row"]') as HTMLButtonElement;
    deleteBtn.click();
    expect(fn).toHaveBeenCalledWith('del-test');
  });

  it('sync-status-changed updates status badge', () => {
    const ann = makeAnnotation({ id: 'sync-test' });
    env.eventBus.emit('annotations-changed', [ann]);
    env.eventBus.emit('sync-status-changed', 'sync-test', 'synced');
    const badge = env.container.querySelector('[data-annotation-id="sync-test"] .agt-toolbox-status') as HTMLElement;
    expect(badge.getAttribute('data-status')).toBe('synced');
  });

  it('annotations-changed with empty array renders empty state', () => {
    env.eventBus.emit('annotations-changed', [makeAnnotation()]);
    env.eventBus.emit('annotations-changed', []);
    const cards = env.container.querySelectorAll('.agt-toolbox-card');
    expect(cards.length).toBe(0);
    const empty = env.container.querySelector('.agt-toolbox-empty');
    expect(empty).not.toBeNull();
  });

  it('clear-all button appears when there are annotations', () => {
    env.eventBus.emit('annotations-changed', [makeAnnotation()]);
    const clearBtn = env.container.querySelector('button[data-action="clear-all"]');
    expect(clearBtn).not.toBeNull();
  });

  it('clear-all emits annotation-delete for each annotation', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fn = vi.fn();
    env.eventBus.on('annotation-delete', fn);
    const anns = [makeAnnotation({ id: 'c1' }), makeAnnotation({ id: 'c2' })];
    env.eventBus.emit('annotations-changed', anns);
    const clearBtn = env.container.querySelector('button[data-action="clear-all"]') as HTMLButtonElement;
    clearBtn.click();
    expect(fn).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });

  // ── Freeze toggle ──

  it('clicking freeze button emits freeze-toggle true', () => {
    const fn = vi.fn();
    env.eventBus.on('freeze-toggle', fn);
    const btn = env.container.querySelector('[aria-label="Freeze Page"]') as HTMLButtonElement;
    btn.click();
    expect(fn).toHaveBeenCalledWith(true);
  });

  it('receives freeze-toggle event and updates aria-pressed', () => {
    const btn = env.container.querySelector('[aria-label="Freeze Page"]') as HTMLButtonElement;
    env.eventBus.emit('freeze-toggle', true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    env.eventBus.emit('freeze-toggle', false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  // ── Copy ──

  it('clicking copy button emits copy event', () => {
    const fn = vi.fn();
    env.eventBus.on('copy', fn);
    const btn = env.container.querySelector('[aria-label="Copy Markdown"]') as HTMLButtonElement;
    btn.click();
    expect(fn).toHaveBeenCalledWith('');
  });

  it('copy-success event shows checkmark on copy button', async () => {
    const btn = env.container.querySelector('[aria-label="Copy Markdown"]') as HTMLButtonElement;
    env.eventBus.emit('copy-success');
    expect(btn.classList.contains('agt-toolbox-btn--copied')).toBe(true);
    // Wait for feedback timer to expire
    await new Promise((r) => setTimeout(r, 1600));
    expect(btn.classList.contains('agt-toolbox-btn--copied')).toBe(false);
  });

  // ── Destroy ──

  it('destroy() removes toolbox from DOM', () => {
    expect(env.container.querySelector('.agt-toolbox')).not.toBeNull();
    env.toolbox.destroy();
    expect(env.container.querySelector('.agt-toolbox')).toBeNull();
  });
});
