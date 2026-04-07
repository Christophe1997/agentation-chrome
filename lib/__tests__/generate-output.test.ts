import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Annotation } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'ann-1',
    x: 100,
    y: 200,
    comment: 'This button is misaligned',
    element: 'button: Submit',
    elementPath: 'form > div > button',
    timestamp: 1712000000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateMarkdown
// ---------------------------------------------------------------------------

describe('generateMarkdown', () => {
  let generateMarkdown: (annotations: Annotation[], level?: import('../types').OutputDetailLevel) => string;

  beforeEach(async () => {
    const mod = await import('../generate-output');
    generateMarkdown = mod.generateMarkdown;
  });

  it('returns empty string for empty array', () => {
    expect(generateMarkdown([])).toBe('');
  });

  describe('compact level', () => {
    it('produces numbered list: 1. **element**: comment', () => {
      const anns = [makeAnnotation()];
      const out = generateMarkdown(anns, 'compact');
      expect(out).toBe('1. **button: Submit**: This button is misaligned');
    });

    it('numbers multiple annotations correctly', () => {
      const anns = [
        makeAnnotation({ id: 'a1', element: 'div: Header', comment: 'Wrong color' }),
        makeAnnotation({ id: 'a2', element: 'input[type="text"]', comment: 'No label' }),
      ];
      const out = generateMarkdown(anns, 'compact');
      const lines = out.split('\n');
      expect(lines[0]).toBe('1. **div: Header**: Wrong color');
      expect(lines[1]).toBe('2. **input[type="text"]**: No label');
    });
  });

  describe('standard level (default)', () => {
    it('includes element name, path, and comment', () => {
      const anns = [makeAnnotation()];
      const out = generateMarkdown(anns);
      expect(out).toContain('button: Submit');
      expect(out).toContain('form > div > button');
      expect(out).toContain('This button is misaligned');
    });

    it('includes selected text if present', () => {
      const anns = [makeAnnotation({ selectedText: 'Click me' })];
      const out = generateMarkdown(anns, 'standard');
      expect(out).toContain('Click me');
    });

    it('includes React components if present', () => {
      const anns = [makeAnnotation({ reactComponents: ['SubmitButton', 'Form'] })];
      const out = generateMarkdown(anns, 'standard');
      expect(out).toContain('SubmitButton');
    });

    it('omits React components section when not present', () => {
      const anns = [makeAnnotation()];
      const out = generateMarkdown(anns, 'standard');
      expect(out).not.toContain('React');
    });
  });

  describe('detailed level', () => {
    it('includes CSS classes if present', () => {
      const anns = [makeAnnotation({ cssClasses: ['btn', 'btn-primary'] })];
      const out = generateMarkdown(anns, 'detailed');
      expect(out).toContain('btn');
      expect(out).toContain('btn-primary');
    });

    it('includes bounding box if present', () => {
      const anns = [makeAnnotation({ boundingBox: { x: 10, y: 20, width: 100, height: 40 } })];
      const out = generateMarkdown(anns, 'detailed');
      expect(out).toContain('10');
      expect(out).toContain('20');
    });

    it('includes nearby text if present', () => {
      const anns = [makeAnnotation({ nearbyText: 'nearby text context' })];
      const out = generateMarkdown(anns, 'detailed');
      expect(out).toContain('nearby text context');
    });
  });

  describe('forensic level', () => {
    it('includes full DOM path', () => {
      const anns = [makeAnnotation({ fullPath: 'html > body > main > form > div > button' })];
      const out = generateMarkdown(anns, 'forensic');
      expect(out).toContain('html > body > main > form > div > button');
    });

    it('includes computed styles if present', () => {
      const anns = [makeAnnotation({ computedStyles: { color: 'rgb(0,0,0)', fontSize: '16px' } })];
      const out = generateMarkdown(anns, 'forensic');
      expect(out).toContain('color');
      expect(out).toContain('rgb(0,0,0)');
    });

    it('includes accessibility info if present', () => {
      const anns = [
        makeAnnotation({
          accessibility: { role: 'button', ariaLabel: 'Submit form', focusable: true },
        }),
      ];
      const out = generateMarkdown(anns, 'forensic');
      expect(out).toContain('button');
      expect(out).toContain('Submit form');
    });

    it('includes React component hierarchy if present', () => {
      const anns = [makeAnnotation({ reactComponents: ['App', 'Form', 'SubmitButton'] })];
      const out = generateMarkdown(anns, 'forensic');
      expect(out).toContain('App');
      expect(out).toContain('Form');
      expect(out).toContain('SubmitButton');
    });
  });

  it('defaults to standard level when level is undefined', () => {
    const anns = [makeAnnotation()];
    const withDefault = generateMarkdown(anns);
    const withStandard = generateMarkdown(anns, 'standard');
    expect(withDefault).toBe(withStandard);
  });
});

// ---------------------------------------------------------------------------
// copyToClipboard
// ---------------------------------------------------------------------------

describe('copyToClipboard', () => {
  let copyToClipboard: (text: string) => Promise<boolean>;
  const originalExecCommand = document.execCommand;

  beforeEach(async () => {
    const mod = await import('../generate-output');
    copyToClipboard = mod.copyToClipboard;
  });

  afterEach(() => {
    document.execCommand = originalExecCommand;
    // Restore navigator.clipboard
    vi.restoreAllMocks();
  });

  it('returns true when navigator.clipboard.writeText succeeds', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
    const result = await copyToClipboard('hello');
    expect(result).toBe(true);
  });

  it('falls back to execCommand when clipboard API throws', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('no permission')) },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(true) as typeof document.execCommand;
    const result = await copyToClipboard('fallback text');
    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false when both clipboard API and execCommand fail', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('no permission')) },
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(false) as typeof document.execCommand;
    const result = await copyToClipboard('fail');
    expect(result).toBe(false);
  });
});
