/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { autoTagEntityNames, buildEntityLookup, repairEntityMarkers, type EntityType } from './entity-tags';

describe('autoTagEntityNames', () => {
  it('does not tag common English words that match short flow names like TEST', () => {
    const lookup = buildEntityLookup({
      flows: [{ name: 'TEST' }, { name: 'ECD | Welcome Series NEW' }],
    });
    const input = 'Create a monthly test plan across `flow:ECD | Welcome Series NEW`.';
    const out = autoTagEntityNames(input, lookup);
    expect(out).toContain('monthly test plan');
    expect(out).not.toContain('`flow:test`');
    expect(out).toContain('`flow:ECD | Welcome Series NEW`');
  });

  it('still auto-tags distinctive pipe-style Klaviyo names', () => {
    const lookup = buildEntityLookup({
      flows: [{ name: 'ECD | Abandoned Cart' }],
    });
    const input = 'Keep winners like ECD | Abandoned Cart active.';
    const out = autoTagEntityNames(input, lookup);
    expect(out).toContain('`flow:ECD | Abandoned Cart`');
  });

  it('uses case-sensitive matching for eligible names', () => {
    const lookup = new Map<string, EntityType>([['KlTest Flow', 'flow']]);
    const input = 'Do not match kltest flow in prose.';
    const out = autoTagEntityNames(input, lookup);
    expect(out).toBe(input);
  });
});

describe('repairEntityMarkers', () => {
  it('joins multiline entity marker bodies broken by flattened bullet repair', () => {
    const broken = '`campaign:MM | Community Roundup\n- June 08`';
    expect(repairEntityMarkers(broken)).toBe('`campaign:MM | Community Roundup - June 08`');
  });

  it('repairs multiple split markers in one finding', () => {
    const broken =
      '`campaign:MM | Community Roundup\n- June 08`, `campaign:MM | Community Roundup\n- June 08 (clone)`';
    const out = repairEntityMarkers(broken);
    expect(out).toContain('`campaign:MM | Community Roundup - June 08`');
    expect(out).toContain('`campaign:MM | Community Roundup - June 08 (clone)`');
  });
});
