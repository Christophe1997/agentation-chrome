import { describe, it, expect, beforeEach } from 'vitest';
import {
  identifyElement,
  getElementPath,
  getNearbyText,
  getAccessibilityInfo,
} from '../element-identification';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.firstElementChild as HTMLElement;
}

function appendTo(parent: HTMLElement, child: HTMLElement): HTMLElement {
  parent.appendChild(child);
  return child;
}

// ---------------------------------------------------------------------------
// getElementPath
// ---------------------------------------------------------------------------

describe('getElementPath', () => {
  it('returns tag name for a root element with no meaningful attrs', () => {
    const elem = el('<section></section>');
    document.body.appendChild(elem);
    expect(getElementPath(elem)).toBe('section');
    elem.remove();
  });

  it('prefers class over tag name', () => {
    const elem = el('<div class="sidebar"></div>');
    document.body.appendChild(elem);
    expect(getElementPath(elem)).toContain('.sidebar');
    elem.remove();
  });

  it('strips CSS module hashes from class names', () => {
    const elem = el('<div class="Button_primary__xK9mQ"></div>');
    document.body.appendChild(elem);
    const path = getElementPath(elem);
    expect(path).not.toMatch(/__[a-zA-Z0-9]{4,}/);
    elem.remove();
  });

  it('walks up a max of 4 levels', () => {
    // 5 levels deep: body > div > div > div > div > span
    const span = document.createElement('span');
    let current: HTMLElement = span;
    for (let i = 0; i < 5; i++) {
      const wrapper = document.createElement('div');
      wrapper.appendChild(current);
      current = wrapper;
    }
    document.body.appendChild(current);
    const path = getElementPath(span);
    // Should have at most 4 ancestor segments (including itself)
    const segments = path.split(' > ');
    expect(segments.length).toBeLessThanOrEqual(4);
    current.remove();
  });

  it('uses id when present', () => {
    const elem = el('<button id="submit-btn">Submit</button>');
    document.body.appendChild(elem);
    expect(getElementPath(elem)).toContain('#submit-btn');
    elem.remove();
  });
});

// ---------------------------------------------------------------------------
// getNearbyText
// ---------------------------------------------------------------------------

describe('getNearbyText', () => {
  it('returns own textContent', () => {
    const elem = el('<p>Hello world</p>');
    expect(getNearbyText(elem)).toContain('Hello world');
  });

  it('truncates to 200 chars', () => {
    const long = 'x'.repeat(300);
    const elem = el(`<p>${long}</p>`);
    expect(getNearbyText(elem).length).toBeLessThanOrEqual(200);
  });

  it('includes previous sibling text', () => {
    const parent = document.createElement('div');
    const prev = document.createElement('span');
    prev.textContent = 'prev text';
    const target = document.createElement('button');
    target.textContent = 'click';
    parent.appendChild(prev);
    parent.appendChild(target);
    document.body.appendChild(parent);

    expect(getNearbyText(target)).toContain('prev text');
    parent.remove();
  });

  it('includes next sibling text', () => {
    const parent = document.createElement('div');
    const target = document.createElement('button');
    target.textContent = 'click';
    const next = document.createElement('span');
    next.textContent = 'next text';
    parent.appendChild(target);
    parent.appendChild(next);
    document.body.appendChild(parent);

    expect(getNearbyText(target)).toContain('next text');
    parent.remove();
  });
});

// ---------------------------------------------------------------------------
// getAccessibilityInfo
// ---------------------------------------------------------------------------

describe('getAccessibilityInfo', () => {
  it('returns role from aria-role attribute', () => {
    const elem = el('<div role="dialog"></div>');
    expect(getAccessibilityInfo(elem).role).toBe('dialog');
  });

  it('returns ariaLabel from aria-label attribute', () => {
    const elem = el('<button aria-label="Close">×</button>');
    expect(getAccessibilityInfo(elem).ariaLabel).toBe('Close');
  });

  it('returns tabIndex when set', () => {
    const elem = el('<div tabindex="0"></div>');
    expect(getAccessibilityInfo(elem).tabIndex).toBe(0);
  });

  it('marks interactive elements as focusable', () => {
    const btn = el('<button>Click</button>');
    expect(getAccessibilityInfo(btn).focusable).toBe(true);
  });

  it('marks non-interactive elements without tabindex as not focusable', () => {
    const div = el('<div>Text</div>');
    expect(getAccessibilityInfo(div).focusable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// identifyElement
// ---------------------------------------------------------------------------

describe('identifyElement', () => {
  it('builds a name from tag and text for a plain paragraph', () => {
    const elem = el('<p>Hello</p>');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(info.name).toContain('p');
    elem.remove();
  });

  it('includes button text in name', () => {
    const elem = el('<button>Submit</button>');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(info.name).toContain('Submit');
    elem.remove();
  });

  it('includes aria-label in button name over text', () => {
    const elem = el('<button aria-label="Close dialog">×</button>');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(info.name).toContain('Close dialog');
    elem.remove();
  });

  it('includes alt text in img name', () => {
    const elem = el('<img alt="Company logo" src="logo.png" />');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(info.name).toContain('Company logo');
    elem.remove();
  });

  it('includes input type in name', () => {
    const elem = el('<input type="email" placeholder="Enter email" />');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(info.name).toContain('email');
    elem.remove();
  });

  it('returns cssClasses from element', () => {
    const elem = el('<div class="card primary"></div>');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(info.cssClasses).toContain('card');
    expect(info.cssClasses).toContain('primary');
    elem.remove();
  });

  it('strips CSS module hashes from cssClasses', () => {
    const elem = el('<div class="Button_primary__xK9mQ"></div>');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(info.cssClasses.some((c: string) => c.match(/__[a-zA-Z0-9]{4,}/))).toBe(false);
    elem.remove();
  });

  it('returns path as a string', () => {
    const elem = el('<div class="card"></div>');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(typeof info.path).toBe('string');
    expect(info.path.length).toBeGreaterThan(0);
    elem.remove();
  });

  it('returns nearbyElements with up to 4 siblings', () => {
    const parent = document.createElement('div');
    const target = document.createElement('button');
    target.textContent = 'target';
    for (let i = 0; i < 6; i++) {
      const sib = document.createElement('span');
      sib.textContent = `sibling ${i}`;
      parent.appendChild(sib);
    }
    parent.appendChild(target);
    document.body.appendChild(parent);

    const info = identifyElement(target);
    expect(info.nearbyElements.length).toBeLessThanOrEqual(4);
    parent.remove();
  });

  it('returns accessibility info', () => {
    const elem = el('<button aria-label="Open menu">☰</button>');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(info.accessibility.ariaLabel).toBe('Open menu');
    expect(info.accessibility.focusable).toBe(true);
    elem.remove();
  });

  it('returns boundingBox with numeric properties', () => {
    const elem = el('<div style="width:100px;height:50px">box</div>');
    document.body.appendChild(elem);
    const info = identifyElement(elem);
    expect(typeof info.boundingBox.x).toBe('number');
    expect(typeof info.boundingBox.width).toBe('number');
    elem.remove();
  });
});
