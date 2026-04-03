import type { AccessibilityInfo, NearbyElement } from './types';

export interface ElementInfo {
  name: string;
  path: string;
  fullPath: string;
  nearbyText: string;
  cssClasses: string[];
  computedStyles: Record<string, string>;
  boundingBox: { x: number; y: number; width: number; height: number };
  accessibility: AccessibilityInfo;
  nearbyElements: NearbyElement[];
}

const CSS_HASH_RE = /__[a-zA-Z0-9]{4,}$/;
const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function identifyElement(element: Element): ElementInfo {
  // Single-pass: batch all layout reads before any tree walking
  const rect = element.getBoundingClientRect();
  const computed = window.getComputedStyle(element);

  return {
    name: buildName(element),
    path: getElementPath(element, 4),
    fullPath: getElementPath(element, 100),
    nearbyText: getNearbyText(element),
    cssClasses: getClasses(element),
    computedStyles: getComputedStylesForElement(element, computed),
    boundingBox: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    accessibility: getAccessibilityInfo(element),
    nearbyElements: getNearbyElements(element),
  };
}

export function getElementPath(element: Element, maxDepth = 4): string {
  const segments: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && current !== document.body && current !== document.documentElement && depth < maxDepth) {
    segments.unshift(segmentFor(current));
    current = current.parentElement;
    depth++;
  }

  return segments.join(' > ') || segmentFor(element);
}

export function getNearbyText(element: Element): string {
  const own = (element.textContent ?? '').slice(0, 200);
  const prev = (element.previousElementSibling?.textContent ?? '').slice(0, 30);
  const next = (element.nextElementSibling?.textContent ?? '').slice(0, 30);

  const parts = [prev, own, next].filter(Boolean);
  return parts.join(' ').trim().slice(0, 200);
}

export function getAccessibilityInfo(element: Element): AccessibilityInfo {
  const role = element.getAttribute('role') ?? undefined;
  const ariaLabel = element.getAttribute('aria-label') ?? undefined;
  const ariaDescribedBy = element.getAttribute('aria-describedby') ?? undefined;
  const tabIndexAttr = element.getAttribute('tabindex');
  const tabIndex = tabIndexAttr !== null ? parseInt(tabIndexAttr, 10) : undefined;

  const tag = element.tagName.toLowerCase();
  const focusable =
    INTERACTIVE_TAGS.has(tag) ||
    tabIndex !== undefined ||
    element.getAttribute('contenteditable') === 'true';

  return { role, ariaLabel, ariaDescribedBy, tabIndex, focusable };
}

export function getComputedStylesForElement(
  element: Element,
  computed?: CSSStyleDeclaration,
): Record<string, string> {
  const style = computed ?? window.getComputedStyle(element);
  const tag = element.tagName.toLowerCase();

  if (INTERACTIVE_TAGS.has(tag)) {
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      padding: style.padding,
      borderRadius: style.borderRadius,
    };
  }

  if (['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label'].includes(tag)) {
    return {
      color: style.color,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
    };
  }

  return {
    display: style.display,
    padding: style.padding,
    margin: style.margin,
    gap: style.gap,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildName(element: Element): string {
  const tag = element.tagName.toLowerCase();

  // Prefer aria-label for interactive elements
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return `${tag}[aria-label="${ariaLabel.slice(0, 50)}"]`;

  // img: use alt
  if (tag === 'img') {
    const alt = element.getAttribute('alt');
    if (alt) return `img[alt="${alt.slice(0, 50)}"]`;
    return 'img';
  }

  // input: use type + placeholder
  if (tag === 'input') {
    const type = element.getAttribute('type') ?? 'text';
    const placeholder = element.getAttribute('placeholder');
    return placeholder ? `input[type="${type}"][placeholder="${placeholder.slice(0, 30)}"]` : `input[type="${type}"]`;
  }

  // text-bearing elements: include text
  const text = (element.textContent ?? '').trim().slice(0, 50);
  if (text) return `${tag}: ${text}`;

  return tag;
}

function segmentFor(element: Element): string {
  const tag = element.tagName.toLowerCase();

  const id = element.id;
  if (id) return `${tag}#${id}`;

  const classes = getClasses(element);
  if (classes.length > 0) return `${tag}.${classes[0]}`;

  return tag;
}

function getClasses(element: Element): string[] {
  return Array.from(element.classList)
    .map(stripHash)
    .filter(Boolean);
}

function stripHash(cls: string): string {
  return cls.replace(CSS_HASH_RE, '');
}

function getNearbyElements(element: Element): NearbyElement[] {
  const parent = element.parentElement;
  if (!parent) return [];

  const siblings = Array.from(parent.children).filter((c) => c !== element);
  return siblings.slice(0, 4).map((sib) => ({
    tag: sib.tagName.toLowerCase(),
    text: (sib.textContent ?? '').trim().slice(0, 30) || undefined,
    class: sib.classList[0] ?? undefined,
  }));
}
