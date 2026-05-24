export type EntityHighlightStyle = 'purple' | 'yellow' | 'emerald' | 'disabled';

export const ENTITY_HIGHLIGHT_STYLES: EntityHighlightStyle[] = ['purple', 'yellow', 'emerald', 'disabled'];

export const ENTITY_HIGHLIGHT_LABELS: Record<EntityHighlightStyle, string> = {
  purple: 'Purple',
  yellow: 'Yellow',
  emerald: 'Emerald',
  disabled: 'Disabled',
};

export const ENTITY_HIGHLIGHT_DESCRIPTIONS: Record<EntityHighlightStyle, string> = {
  purple: 'Soft indigo chips for flows, segments, and campaigns.',
  yellow: 'Warm amber chips for high-visibility callouts.',
  emerald: 'Green chips for a calmer, success-toned look.',
  disabled: 'Show Klaviyo asset names as plain text with no highlight styling.',
};

/** Preview swatches for admin settings UI. */
export const ENTITY_HIGHLIGHT_SWATCHES: Record<
  Exclude<EntityHighlightStyle, 'disabled'>,
  { bg: string; border: string; text: string }
> = {
  purple: {
    bg: '#eef2ffe6',
    border: '#e0e7ffe6',
    text: 'rgb(55 48 163)',
  },
  yellow: {
    bg: '#fffbebe6',
    border: '#fef3c7e6',
    text: 'rgb(120 53 15)',
  },
  emerald: {
    bg: '#ecfdf5e6',
    border: '#d1fae5e6',
    text: 'rgb(6 95 70)',
  },
};

export function normalizeEntityHighlightStyle(value: unknown): EntityHighlightStyle {
  if (value === 'yellow' || value === 'emerald' || value === 'disabled') return value;
  return 'purple';
}

export function applyEntityHighlightStyle(style: EntityHighlightStyle): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.entityHighlight = style;
}

export function entityHighlightsEnabled(style: EntityHighlightStyle): boolean {
  return style !== 'disabled';
}
