import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must run in jsdom (see vitest.config.ts)

describe('isReactPage', () => {
  let isReactPage: () => boolean;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../react-detection');
    isReactPage = mod.isReactPage;
  });

  it('returns false when no React fiber key present on any element', () => {
    // jsdom has no React fiber keys by default
    expect(isReactPage()).toBe(false);
  });

  it('returns true when an element has __reactFiber$ key', () => {
    const div = document.createElement('div');
    (div as unknown as Record<string, unknown>)['__reactFiber$abc123'] = {};
    document.body.appendChild(div);

    expect(isReactPage()).toBe(true);
    div.remove();
  });

  it('returns true when an element has __reactInternalInstance$ key (React 16)', () => {
    const div = document.createElement('div');
    (div as unknown as Record<string, unknown>)['__reactInternalInstance$abc'] = {};
    document.body.appendChild(div);

    expect(isReactPage()).toBe(true);
    div.remove();
  });
});

describe('getReactComponents', () => {
  let getReactComponents: (el: Element, mode?: import('../types').ReactComponentMode) => string[];

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../react-detection');
    getReactComponents = mod.getReactComponents;
  });

  it('returns empty array when element has no fiber key', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(getReactComponents(el)).toEqual([]);
    el.remove();
  });

  it('returns component names from fiber stateNode', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    // Simulate a fiber chain:
    // el.__reactFiber$xxx → { type: { name: 'MyButton' }, return: { type: { name: 'MyForm' }, return: null } }
    const fiberKey = '__reactFiber$xyz';
    (el as unknown as Record<string, unknown>)[fiberKey] = {
      type: { name: 'MyButton' },
      return: {
        type: { name: 'MyForm' },
        return: null,
      },
    };

    const names = getReactComponents(el, 'all');
    expect(names).toContain('MyButton');
    expect(names).toContain('MyForm');

    el.remove();
  });

  it('skips null type nodes', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const fiberKey = '__reactFiber$abc';
    (el as unknown as Record<string, unknown>)[fiberKey] = {
      type: null,
      return: {
        type: { name: 'ValidComponent' },
        return: null,
      },
    };

    const names = getReactComponents(el, 'all');
    expect(names).toContain('ValidComponent');
    expect(names).not.toContain('null');

    el.remove();
  });

  it('skips string type nodes (DOM elements like "div")', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const fiberKey = '__reactFiber$abc';
    (el as unknown as Record<string, unknown>)[fiberKey] = {
      type: 'div',
      return: {
        type: { name: 'RealComponent' },
        return: null,
      },
    };

    const names = getReactComponents(el, 'all');
    expect(names).not.toContain('div');
    expect(names).toContain('RealComponent');

    el.remove();
  });

  it('filtered mode skips ErrorBoundary, Provider, Consumer', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const fiberKey = '__reactFiber$abc';
    (el as unknown as Record<string, unknown>)[fiberKey] = {
      type: { name: 'ErrorBoundary' },
      return: {
        type: { name: 'Provider' },
        return: {
          type: { name: 'RealComponent' },
          return: null,
        },
      },
    };

    const names = getReactComponents(el, 'filtered');
    expect(names).not.toContain('ErrorBoundary');
    expect(names).not.toContain('Provider');
    expect(names).toContain('RealComponent');

    el.remove();
  });

  it('respects depth limit of 30', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    // Build a chain of 35 fiber nodes
    let fiber: Record<string, unknown> = { type: { name: 'Component35' }, return: null };
    for (let i = 34; i >= 1; i--) {
      fiber = { type: { name: `Component${i}` }, return: fiber };
    }
    const fiberKey = '__reactFiber$abc';
    (el as unknown as Record<string, unknown>)[fiberKey] = fiber;

    const names = getReactComponents(el, 'all');
    // Should not have more than 30 components
    expect(names.length).toBeLessThanOrEqual(30);

    el.remove();
  });

  it('returns empty array for anonymous functions (no name)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const fiberKey = '__reactFiber$abc';
    (el as unknown as Record<string, unknown>)[fiberKey] = {
      type: { name: '' },
      return: null,
    };

    const names = getReactComponents(el, 'all');
    expect(names).toEqual([]);

    el.remove();
  });
});
