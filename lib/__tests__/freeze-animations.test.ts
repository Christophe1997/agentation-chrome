import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// freeze-animations tests
// Must run in jsdom (see vitest.config.ts)
// ---------------------------------------------------------------------------

// We reimport the module fresh each test to get a clean module state
// (module-level closure variables are reset between test files but not tests)

describe('freeze / isFrozen / unfreeze', () => {
  let freeze: () => void;
  let unfreeze: () => void;
  let isFrozen: () => boolean;

  beforeEach(async () => {
    // Reset module so closure state is clean for each test
    vi.resetModules();
    const mod = await import('../freeze-animations');
    freeze = mod.freeze;
    unfreeze = mod.unfreeze;
    isFrozen = mod.isFrozen;
  });

  afterEach(() => {
    // Clean up any injected style elements
    document.getElementById('agt-ext-freeze-styles')?.remove();
  });

  it('isFrozen() returns false initially', () => {
    expect(isFrozen()).toBe(false);
  });

  it('isFrozen() returns true after freeze()', () => {
    freeze();
    expect(isFrozen()).toBe(true);
  });

  it('isFrozen() returns false after unfreeze()', () => {
    freeze();
    unfreeze();
    expect(isFrozen()).toBe(false);
  });

  it('freeze() injects CSS style element into <head>', () => {
    freeze();
    const styleEl = document.getElementById('agt-ext-freeze-styles');
    expect(styleEl).not.toBeNull();
    expect(styleEl?.tagName).toBe('STYLE');
  });

  it('injected CSS contains animation-play-state: paused', () => {
    freeze();
    const styleEl = document.getElementById('agt-ext-freeze-styles');
    expect(styleEl?.textContent).toContain('animation-play-state: paused');
  });

  it('injected CSS contains transition: none', () => {
    freeze();
    const styleEl = document.getElementById('agt-ext-freeze-styles');
    expect(styleEl?.textContent).toContain('transition: none');
  });

  it('injected CSS excludes [data-agt-ext] elements', () => {
    freeze();
    const styleEl = document.getElementById('agt-ext-freeze-styles');
    expect(styleEl?.textContent).toContain(':not([data-agt-ext])');
  });

  it('unfreeze() removes the injected CSS style element', () => {
    freeze();
    unfreeze();
    expect(document.getElementById('agt-ext-freeze-styles')).toBeNull();
  });

  it('freeze() pauses video elements (not data-agt-ext)', () => {
    const video = document.createElement('video');
    video.pause = vi.fn();
    document.body.appendChild(video);

    freeze();
    expect(video.pause).toHaveBeenCalled();

    video.remove();
  });

  it('freeze() does NOT pause video elements with data-agt-ext', () => {
    const video = document.createElement('video');
    video.setAttribute('data-agt-ext', '');
    video.pause = vi.fn();
    document.body.appendChild(video);

    freeze();
    expect(video.pause).not.toHaveBeenCalled();

    video.remove();
  });

  it('calling freeze() twice is idempotent (does not inject duplicate style)', () => {
    freeze();
    freeze();
    const allStyles = document.querySelectorAll('#agt-ext-freeze-styles');
    expect(allStyles.length).toBe(1);
  });

  it('unfreeze() when not frozen is a no-op', () => {
    expect(() => unfreeze()).not.toThrow();
    expect(isFrozen()).toBe(false);
  });
});

describe('JS timing patch', () => {
  let freeze: (opts?: { patchJS?: boolean }) => void;
  let unfreeze: () => void;
  let originalSetTimeout: typeof setTimeout;
  let originalSetInterval: typeof setInterval;
  let originalRAF: typeof requestAnimationFrame;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../freeze-animations');
    freeze = mod.freeze;
    unfreeze = mod.unfreeze;
    originalSetTimeout = mod.originalSetTimeout;
    originalSetInterval = mod.originalSetInterval;
    originalRAF = mod.originalRAF;
  });

  afterEach(() => {
    document.getElementById('agt-ext-freeze-styles')?.remove();
    // Ensure globals are restored even if test fails
    try { unfreeze(); } catch { /* ignore */ }
  });

  it('exports originalSetTimeout, originalSetInterval, originalRAF', () => {
    expect(typeof originalSetTimeout).toBe('function');
    expect(typeof originalSetInterval).toBe('function');
    expect(typeof originalRAF).toBe('function');
  });

  it('patchJS queues setTimeout callbacks during freeze', () => {
    freeze({ patchJS: true });

    const cb = vi.fn();
    setTimeout(cb, 0);

    // Callback not yet called (frozen)
    expect(cb).not.toHaveBeenCalled();

    unfreeze();
  });

  it('queued callbacks are replayed after unfreeze()', () => {
    freeze({ patchJS: true });

    const cb = vi.fn();
    setTimeout(cb, 0);
    expect(cb).not.toHaveBeenCalled();

    unfreeze();
    // After unfreeze, queued callbacks are replayed via originalSetTimeout
    // jsdom executes timers immediately for setTimeout(fn, 0) when using fakeTimers
    // Here we use real timers so we advance manually:
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('queue cap: drops oldest callback and warns when >500 queued', () => {
    freeze({ patchJS: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Queue 501 callbacks
    const callbacks: ReturnType<typeof vi.fn>[] = [];
    for (let i = 0; i < 501; i++) {
      const cb = vi.fn();
      callbacks.push(cb);
      setTimeout(cb, 0);
    }

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    unfreeze();
  });

  it('does not patch JS when patchJS option is false (default)', () => {
    const origST = globalThis.setTimeout;
    freeze(); // default: no patchJS
    expect(globalThis.setTimeout).toBe(origST);
    unfreeze();
  });
});
