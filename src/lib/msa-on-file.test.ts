/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { MSA_ON_FILE_SLUG, msaOnFileText, swapMsaForOnFile, type ExecutedMsa } from './msa-on-file';

const signed: ExecutedMsa = {
  proposalId: 'p1',
  proposalTitle: 'Lane 201 SMS Migration',
  signedAt: '2026-09-22T18:00:00Z',
};

describe('MSA on file', () => {
  it('swaps the template MSA for the on-file reference once one is signed', () => {
    const out = swapMsaForOnFile(['msa', 'operating_agreement'], signed, 'Lane 201');
    expect(out.include_contracts).toEqual([MSA_ON_FILE_SLUG, 'operating_agreement']);
    expect(out.overrides[MSA_ON_FILE_SLUG]).toContain('signed on September 22, 2026');
  });

  it('leaves the first proposal alone', () => {
    expect(swapMsaForOnFile(['msa', 'operating_agreement'], null, 'Lane 201')).toEqual({
      include_contracts: ['msa', 'operating_agreement'],
      overrides: {},
    });
  });

  it('does nothing when the MSA was not selected', () => {
    expect(swapMsaForOnFile(['operating_agreement'], signed, 'Lane 201').include_contracts).toEqual(['operating_agreement']);
  });

  it('names the signed agreement and says it is not amended', () => {
    const text = msaOnFileText(signed, 'Lane 201');
    expect(text).toContain('between ECD Digital Strategy and Lane 201');
    expect(text).toContain('“Lane 201 SMS Migration”');
    expect(text).toContain('nothing in this proposal amends it');
    expect(text).not.toContain('—');
  });
});
