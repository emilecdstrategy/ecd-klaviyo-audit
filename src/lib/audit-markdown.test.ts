/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { prepareAuditMarkdown, tokenizeInlineMarkdown } from './audit-markdown';

describe('prepareAuditMarkdown', () => {
  it('repairs entity markers split across bullet newlines inside campaign names', () => {
    const broken =
      '**Operational duplication** `campaign:MM | Community Roundup\n- June 08`, `campaign:MM | Community Roundup\n- June 08 (clone)`, and noise.';
    const repaired = prepareAuditMarkdown(broken);

    expect(repaired).toContain('`campaign:MM | Community Roundup - June 08`');
    expect(repaired).toContain('`campaign:MM | Community Roundup - June 08 (clone)`');
    expect(repaired).not.toMatch(/Roundup\n- June/);

    const tokens = tokenizeInlineMarkdown(repaired);
    const entities = tokens.filter(token => token.type === 'entity');
    expect(entities).toHaveLength(2);
    expect(entities[0]).toMatchObject({
      type: 'entity',
      entityType: 'campaign',
      name: 'MM | Community Roundup - June 08',
    });
  });

  it('does not split hyphenated campaign names inside entity markers', () => {
    const input =
      'Recent sends include `campaign:MM | Summer Solstice Wellness Hacks - June 13` and `campaign:Smart Burn (Backup) | 6/18`.';
    const repaired = prepareAuditMarkdown(input);

    expect(repaired).not.toMatch(/Hacks\n- June/);
    expect(tokenizeInlineMarkdown(repaired).filter(token => token.type === 'entity')).toHaveLength(2);
  });
});
