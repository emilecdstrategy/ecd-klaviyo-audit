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
});
