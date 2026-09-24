/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { parseRichAuditBlocks, prepareAuditMarkdown, tokenizeInlineMarkdown } from './audit-markdown';

describe('parseRichAuditBlocks numbered lists', () => {
  it('keeps counting when items are separated by blank lines', () => {
    const blocks = parseRichAuditBlocks('Gaps:\n\n1. **SEO.** Big one.\n\n2. **Paid media.** Clean.\n\n3. **Phone orders.** Clarify.');
    expect(blocks).toEqual([
      { type: 'paragraph', text: 'Gaps:' },
      { type: 'list', ordered: true, items: ['**SEO.** Big one.', '**Paid media.** Clean.', '**Phone orders.** Clarify.'] },
    ]);
  });

  it('continues from the source number when prose splits a list', () => {
    const blocks = parseRichAuditBlocks('1. First\n2. Second\n\nAside.\n\n3. Third');
    expect(blocks[2]).toEqual({ type: 'list', ordered: true, items: ['Third'], start: 3 });
  });

  it('still ends a list at a blank line followed by prose', () => {
    const blocks = parseRichAuditBlocks('- a\n- b\n\nAfter.');
    expect(blocks).toEqual([
      { type: 'list', ordered: false, items: ['a', 'b'] },
      { type: 'paragraph', text: 'After.' },
    ]);
  });
});

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
