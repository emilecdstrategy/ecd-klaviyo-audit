/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  auditSectionKeyToNavId,
  buildNavSectionDemoMap,
  buildSectionDemoMap,
  getHighlightedAddOns,
} from './addon-highlight';
import type { RevenueOpportunityAddOnItem } from './types';

function item(partial: Partial<RevenueOpportunityAddOnItem> & Pick<RevenueOpportunityAddOnItem, 'template_slug' | 'name'>): RevenueOpportunityAddOnItem {
  return {
    bullets: [],
    revenue_monthly: 0,
    ...partial,
  };
}

describe('buildSectionDemoMap', () => {
  it('maps highlighted add-ons to assigned audit section keys', () => {
    const items = [
      item({
        template_slug: 'klaviyo_cdp',
        name: 'Klaviyo CDP',
        highlighted: true,
        related_section_keys: ['flows', 'segmentation'],
      }),
      item({
        template_slug: 'ecd_flow_rebuild',
        name: 'Flow rebuild',
        highlighted: true,
        related_section_keys: ['flows'],
        presenter_note: 'Show welcome flow gaps.',
      }),
    ];
    const map = buildSectionDemoMap(items);
    expect(map.get('flows')).toHaveLength(2);
    expect(map.get('segmentation')).toHaveLength(1);
    expect(map.get('flows')?.[1]?.presenter_note).toBe('Show welcome flow gaps.');
  });

  it('ignores non-highlighted and hidden add-ons', () => {
    const items = [
      item({
        template_slug: 'klaviyo_cdp',
        name: 'Klaviyo CDP',
        highlighted: false,
        related_section_keys: ['flows'],
      }),
      item({
        template_slug: 'ecd_flow_rebuild',
        name: 'Flow rebuild',
        highlighted: true,
        is_hidden: true,
        related_section_keys: ['flows'],
      }),
    ];
    const map = buildSectionDemoMap(items);
    expect(map.size).toBe(0);
  });

  it('dedupes the same add-on when duplicate section keys are stored', () => {
    const items = [
      item({
        template_slug: 'klaviyo_cdp',
        name: 'Klaviyo CDP',
        highlighted: true,
        related_section_keys: ['flows', 'flows'],
      }),
    ];
    const map = buildSectionDemoMap(items);
    expect(map.get('flows')).toHaveLength(1);
  });
});

describe('buildNavSectionDemoMap', () => {
  it('translates audit section keys to report nav ids', () => {
    const items = [
      item({
        template_slug: 'klaviyo_cdp',
        name: 'Klaviyo CDP',
        highlighted: true,
        related_section_keys: ['account_health', 'signup_forms'],
      }),
    ];
    const map = buildNavSectionDemoMap(items);
    expect(map.get('deliverability')).toHaveLength(1);
    expect(map.get('forms')).toHaveLength(1);
    expect(auditSectionKeyToNavId('account_health')).toBe('deliverability');
  });
});

describe('getHighlightedAddOns', () => {
  it('returns only visible highlighted items', () => {
    const items = [
      item({ template_slug: 'a', name: 'A', highlighted: true }),
      item({ template_slug: 'b', name: 'B', highlighted: true, is_hidden: true }),
      item({ template_slug: 'c', name: 'C', highlighted: false }),
    ];
    expect(getHighlightedAddOns(items).map(i => i.template_slug)).toEqual(['a']);
  });
});
