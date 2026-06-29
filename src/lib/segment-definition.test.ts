import { describe, expect, it } from 'vitest';
import { buildSegmentSignalTags, parseSegmentDefinition } from './segment-definition';

describe('segment-definition', () => {
  it('parses profile-metric conditions with apple privacy and bot filters', () => {
    const parsed = parseSegmentDefinition({
      raw: {
        attributes: {
          definition: {
            condition_groups: [
              {
                conditions: [
                  {
                    type: 'profile-metric',
                    metric_id: 'abc123',
                    measurement: 'count',
                    measurement_filter: { type: 'numeric', operator: 'greater-than', value: 0 },
                    timeframe_filter: { type: 'relative', operator: 'in-the-last', quantity: 30, unit: 'day' },
                    metric_filters: [
                      {
                        property: 'Apple Privacy Open',
                        filter: { type: 'boolean', operator: 'equals', value: false },
                      },
                      {
                        property: 'Bot Click',
                        filter: { type: 'boolean', operator: 'equals', value: false },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        _ecd_metric_names: { abc123: 'Opened Email' },
      },
    });

    expect(parsed.available).toBe(true);
    expect(parsed.signals.excludesApplePrivacyOpens).toBe(true);
    expect(parsed.signals.excludesBotClicks).toBe(true);
    expect(parsed.signals.usesEmailOpens).toBe(true);
    expect(buildSegmentSignalTags(parsed.signals)).toContain('Excludes Apple Privacy opens');
  });

  it('returns unavailable when definition is missing', () => {
    const parsed = parseSegmentDefinition({ raw: { attributes: { name: 'Test' } } });
    expect(parsed.available).toBe(false);
    expect(parsed.criteriaLines).toEqual([]);
  });

  it('resolves profile-group-membership IDs to readable names', () => {
    const parsed = parseSegmentDefinition(
      {
        raw: {
          attributes: {
            definition: {
              condition_groups: [
                {
                  conditions: [
                    {
                      type: 'profile-group-membership',
                      is_member: false,
                      group_ids: ['list1', 'seg1'],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
      undefined,
      {
        list1: { name: 'All Malicious', kind: 'list' },
        seg1: { name: 'Engaged 30 Day', kind: 'segment' },
      },
    );
    expect(parsed.criteriaLines[0]).toBe(
      'Is not in list “All Malicious”, segment “Engaged 30 Day”',
    );
  });

  it('parses profile-property conditions with email contains filters', () => {
    const parsed = parseSegmentDefinition({
      raw: {
        attributes: {
          definition: {
            condition_groups: [
              {
                conditions: [
                  {
                    type: 'profile-property',
                    property: 'email',
                    filter: { type: 'string', operator: 'contains', value: 'abuse@' },
                  },
                  {
                    type: 'profile-property',
                    property: 'email',
                    filter: { type: 'string', operator: 'contains', value: 'support@' },
                  },
                ],
              },
              {
                conditions: [
                  {
                    type: 'profile-metric',
                    metric_id: 'S87HUX',
                    measurement: 'count',
                    measurement_filter: { type: 'numeric', operator: 'equals', value: 0 },
                  },
                ],
              },
            ],
          },
        },
        _ecd_metric_names: { S87HUX: 'Manually Suppressed from Email Marketing' },
      },
    });

    expect(parsed.available).toBe(true);
    expect(parsed.criteriaLines).toHaveLength(3);
    expect(parsed.criteriaLines[0]).toBe('Group 1: email contains abuse@');
    expect(parsed.criteriaLines[1]).toBe('Group 1: email contains support@');
    expect(parsed.criteriaLines[2]).toContain('Manually Suppressed from Email Marketing');
  });
});
