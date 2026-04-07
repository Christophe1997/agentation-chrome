/**
 * Adaptive theme detection — reads the page background luminance
 * and returns 'dark' or 'light' for the toolbox theme.
 */
export type Theme = 'dark' | 'light';

/** Relative luminance threshold: below → dark, above → light. */
const LUMINANCE_THRESHOLD = 0.5;

/**
 * Convert an RGB triplet (0–255) to relative luminance (ITU-R BT.709).
 */
function rgbToLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255];
  const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * linearize(rs) + 0.7152 * linearize(gs) + 0.0722 * linearize(bs);
}

/**
 * Parse a CSS color string into [r, g, b] or null if unparseable.
 * Handles `rgb(r, g, b)` and hex `#rrggbb` / `#rgb`.
 */
function parseColor(color: string): [number, number, number] | null {
  // rgb(r, g, b)
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return [+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]];
  }
  // #rrggbb or #rgb
  const hexMatch = color.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16)];
    }
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return null;
}

/**
 * Get the effective background color of an element, recursing through
 * transparent ancestors up to <html>. Returns null if nothing is found.
 */
function getEffectiveBackground(el: Element): string | null {
  const style = getComputedStyle(el);
  const bg = style.backgroundColor;
  if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
    return bg;
  }
  if (el.parentElement && el.parentElement !== el) {
    return getEffectiveBackground(el.parentElement);
  }
  return null;
}

/**
 * Detect whether the page background is dark or light.
 * Falls back to 'dark' if detection fails.
 */
export function detectTheme(): Theme {
  const bg = getEffectiveBackground(document.body) ?? getEffectiveBackground(document.documentElement);
  if (!bg) return 'dark';

  const rgb = parseColor(bg);
  if (!rgb) return 'dark';

  return rgbToLuminance(...rgb) < LUMINANCE_THRESHOLD ? 'dark' : 'light';
}

/**
 * Create a debounced MutationObserver that re-runs `onThemeChange`
 * whenever `document.body`'s inline `style` attribute mutates.
 * Returns a disconnect function.
 */
export function watchBodyStyle(onThemeChange: () => void, debounceMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'style') {
        if (timer) clearTimeout(timer);
        timer = setTimeout(onThemeChange, debounceMs);
        return;
      }
    }
  });

  observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });

  return () => {
    if (timer) clearTimeout(timer);
    observer.disconnect();
  };
}
