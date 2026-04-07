import type { Annotation, OutputDetailLevel } from './types';

export function generateMarkdown(annotations: Annotation[], level: OutputDetailLevel = 'standard'): string {
  if (annotations.length === 0) return '';
  const separator = level === 'compact' ? '\n' : '\n\n';
  return annotations.map((ann, i) => formatAnnotation(ann, i + 1, level)).join(separator);
}

function formatAnnotation(ann: Annotation, index: number, level: OutputDetailLevel): string {
  if (level === 'compact') {
    return `${index}. **${ann.element}**: ${ann.comment}`;
  }

  const lines: string[] = [];

  lines.push(`### ${index}. ${ann.element}`);
  lines.push(`**Path:** \`${ann.elementPath}\``);

  if (ann.reactComponents && ann.reactComponents.length > 0) {
    lines.push(`**React components:** ${ann.reactComponents.join(' > ')}`);
  }

  if (ann.selectedText) {
    lines.push(`**Selected text:** "${ann.selectedText}"`);
  }

  lines.push(`**Comment:** ${ann.comment}`);

  if (level === 'detailed' || level === 'forensic') {
    if (ann.cssClasses && ann.cssClasses.length > 0) {
      lines.push(`**CSS classes:** ${ann.cssClasses.join(', ')}`);
    }
    if (ann.boundingBox) {
      const b = ann.boundingBox;
      lines.push(`**Bounding box:** x=${b.x}, y=${b.y}, w=${b.width}, h=${b.height}`);
    }
    if (ann.nearbyText) {
      lines.push(`**Nearby text:** ${ann.nearbyText}`);
    }
  }

  if (level === 'forensic') {
    if (ann.fullPath) {
      lines.push(`**Full DOM path:** \`${ann.fullPath}\``);
    }
    if (ann.computedStyles && Object.keys(ann.computedStyles).length > 0) {
      const styleEntries = Object.entries(ann.computedStyles)
        .map(([k, v]) => `  ${k}: ${v}`)
        .join('\n');
      lines.push(`**Computed styles:**\n${styleEntries}`);
    }
    if (ann.accessibility) {
      const a11y = ann.accessibility;
      const parts: string[] = [];
      if (a11y.role) parts.push(`role=${a11y.role}`);
      if (a11y.ariaLabel) parts.push(`aria-label="${a11y.ariaLabel}"`);
      if (a11y.focusable) parts.push('focusable');
      if (parts.length > 0) {
        lines.push(`**Accessibility:** ${parts.join(', ')}`);
      }
    }
    if (ann.reactComponents && ann.reactComponents.length > 0) {
      // Already included above in standard — for forensic repeat as hierarchy
      lines.push(`**React component hierarchy:** ${ann.reactComponents.join(' > ')}`);
    }
  }

  return lines.join('\n');
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  }
}
