import { describe, expect, it } from 'vitest';
import { canApplyPayloadKind } from './agent-apply';

const draftOnly = { onApplyDraft: () => {} };
const editsOnly = { onApplyEdits: () => {} };
const both = { onApplyDraft: () => {}, onApplyEdits: () => {} };

describe('canApplyPayloadKind', () => {
  // The proposal editor (and the read-only detail page) wired only
  // onApplyEdits. A draft arrived, the Apply button rendered anyway, and the
  // click silently did nothing. The button must not offer what the page cannot do.
  it('does not offer Apply for a draft on a page that only takes edits', () => {
    expect(canApplyPayloadKind(editsOnly, 'draft')).toBe(false);
    expect(canApplyPayloadKind(editsOnly, 'edits')).toBe(true);
  });

  it('does not offer Apply for edits on a page that only takes drafts', () => {
    expect(canApplyPayloadKind(draftOnly, 'edits')).toBe(false);
    expect(canApplyPayloadKind(draftOnly, 'draft')).toBe(true);
  });

  it('offers both once the page handles both', () => {
    expect(canApplyPayloadKind(both, 'draft')).toBe(true);
    expect(canApplyPayloadKind(both, 'edits')).toBe(true);
  });

  it('never offers Apply for a kind that is not applyable', () => {
    for (const kind of ['question', 'catalog', 'doc_fetch', '', null, undefined, 'DRAFT']) {
      expect(canApplyPayloadKind(both, kind)).toBe(false);
    }
  });

  it('offers nothing when the page wired no handlers at all', () => {
    expect(canApplyPayloadKind({}, 'draft')).toBe(false);
    expect(canApplyPayloadKind({}, 'edits')).toBe(false);
  });
});
