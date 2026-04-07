import { LIMITS } from './constants';
import type { ReactComponentMode } from './types';

// ---------------------------------------------------------------------------
// Fiber key detection
// ---------------------------------------------------------------------------

const FIBER_KEY_PREFIXES = ['__reactFiber$', '__reactInternalInstance$'];

function getFiberKey(element: Element): string | undefined {
  const keys = Object.keys(element);
  return keys.find((k) => FIBER_KEY_PREFIXES.some((prefix) => k.startsWith(prefix)));
}

// ---------------------------------------------------------------------------
// Filtered mode skip-list
// ---------------------------------------------------------------------------

const FILTERED_SKIP = new Set([
  'ErrorBoundary',
  'Provider',
  'Consumer',
  'Router',
  'Suspense',
  'StrictMode',
  'Fragment',
  'Context',
]);

function shouldSkipFiltered(name: string): boolean {
  if (FILTERED_SKIP.has(name)) return true;
  if (name.endsWith('Provider') || name.endsWith('Consumer') || name.endsWith('Context')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function isReactPage(): boolean {
  // Scan a sample of elements for React fiber keys
  const sample = Array.from(document.querySelectorAll('*')).slice(0, 200);
  for (const el of sample) {
    if (getFiberKey(el) !== undefined) return true;
  }
  return false;
}

export function getReactComponents(element: Element, mode: ReactComponentMode = 'smart'): string[] {
  const fiberKey = getFiberKey(element);
  if (!fiberKey) return [];

  const names: string[] = [];
  const start = performance.now();
  let fiber: unknown = (element as unknown as Record<string, unknown>)[fiberKey];
  let depth = 0;

  while (fiber && depth < LIMITS.REACT_FIBER_DEPTH_LIMIT) {
    // Abort after time budget
    if (performance.now() - start > LIMITS.REACT_FIBER_TIME_BUDGET_MS) break;

    const node = fiber as { type?: unknown; return?: unknown };
    const type = node.type;

    if (type !== null && typeof type === 'object' && 'name' in (type as object)) {
      const name = (type as { name: string }).name;
      if (name && typeof name === 'string') {
        if (mode !== 'filtered' || !shouldSkipFiltered(name)) {
          names.push(name);
        }
      }
    }
    // Skip: null types and string types (DOM elements)

    fiber = node.return;
    depth++;
  }

  return names;
}

// ---------------------------------------------------------------------------
// Dynamic import helper — only loads react-detection on React pages
// ---------------------------------------------------------------------------

export async function identifyElementWithReact(
  element: Element,
  identifyElement: (el: Element) => import('./element-identification').ElementInfo,
): Promise<import('./element-identification').ElementInfo & { reactComponents?: string[] }> {
  const info = identifyElement(element);
  if (isReactPage()) {
    const { getReactComponents: getRC } = await import('./react-detection');
    return { ...info, reactComponents: getRC(element) };
  }
  return info;
}
