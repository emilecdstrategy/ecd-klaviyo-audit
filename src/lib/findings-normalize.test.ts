/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  getExecutiveFindingsForEdit,
  isFindingContinuation,
  mergeFindingContinuation,
  repairSplitFindings,
  resolveExecutiveFindings,
} from './findings-normalize';

describe('findings-normalize', () => {
  it('merges schema-split subscription lifecycle finding', () => {
    const split = [
      '**Subscription lifecycle is fragmented right now**, you have multiple draft flows sitting idle, including **Nightcap Drops to Gummy Subscription**, **Detox Enzyme Subscription Upsell (8.11.23)**, **Nightcap Gummy > Subscription**, **Gut Therapy Subscription Upsell**, and **Night Gummy Subscription P',
      'ush**, while **MM | Subscription Upsell** is still manual.',
      '**Your highest-volume welcome flow is under-converting**, **Evergreen New Subscriber Flow** reached **24,891 recipients** but converted at just **0.15%**.',
    ];
    const repaired = repairSplitFindings(split);
    expect(repaired).toHaveLength(2);
    expect(repaired[0]).toContain('**Night Gummy Subscription Push**, while **MM | Subscription Upsell**');
    expect(repaired[1]).toMatch(/^\*\*Your highest-volume welcome flow/);
  });

  it('does not merge distinct findings', () => {
    const items = [
      '**No post-purchase flow**, repeat revenue is uncaptured.',
      '**Welcome flow under-converts**, only **0.15%** conversion.',
    ];
    expect(repairSplitFindings(items)).toEqual(items);
  });

  it('getExecutiveFindingsForEdit preserves blank rows and explicit findings arrays', () => {
    expect(getExecutiveFindingsForEdit(['One', ''], [])).toEqual(['One', '']);
    expect(getExecutiveFindingsForEdit(['', ''], [])).toEqual(['', '']);
    expect(getExecutiveFindingsForEdit(undefined, [])).toHaveLength(5);
  });

  it('resolveExecutiveFindings prefers findings then falls back to concerns', () => {
    const concerns = [
      '**First concern part A',
      'part B**, with more detail.',
      '**Second concern**, detail.',
      '**Third**, detail.',
      '**Fourth**, detail.',
      '**Fifth**, detail.',
    ];
    const resolved = resolveExecutiveFindings([], concerns);
    expect(resolved[0]).toBe('**First concern part Apart B**, with more detail.');
    expect(resolved).toHaveLength(5);
  });

  it('detects mid-word continuation', () => {
    expect(isFindingContinuation('ends with P', 'ush**, while next')).toBe(true);
    expect(mergeFindingContinuation('ends with P', 'ush**, while next')).toBe('ends with Push**, while next');
  });
});
