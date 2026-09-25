// A client signs the Master Services Agreement once. Later proposals for the
// same client are Statements of Work under that signed MSA, so they attach a
// short "MSA on file" reference instead of the full template again. Resending
// the template looked like an attempt to swap in new terms, especially for
// clients who negotiated redlines to the original (Zak, 2026-09-25).

export const MSA_SLUG = 'msa';
export const MSA_ON_FILE_SLUG = 'msa_on_file';

export type ExecutedMsa = {
  proposalId: string;
  proposalTitle: string;
  signedAt: string;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** The reference text frozen into the proposal in place of the full MSA. */
export function msaOnFileText(msa: ExecutedMsa, clientName: string): string {
  const client = clientName.trim() || 'Client';
  return [
    '**Governing Agreement**',
    '',
    `This proposal is a Statement of Work under the Master Services Agreement between ECD Digital Strategy and ${client}, ` +
      `signed on ${formatDate(msa.signedAt)} with the proposal “${msa.proposalTitle.trim()}”, as that agreement was executed, ` +
      'including any changes the parties agreed to at the time (the “MSA”).',
    '',
    'The MSA governs this Statement of Work. It is not restated here, and nothing in this proposal amends it.',
  ].join('\n');
}

/**
 * Contracts to attach for a client. When the client already signed an MSA and
 * the selection includes the template MSA, it is swapped for the on-file
 * reference and the reference text is returned as the override for it.
 */
export function swapMsaForOnFile(
  contracts: string[],
  msa: ExecutedMsa | null,
  clientName: string,
): { include_contracts: string[]; overrides: Record<string, string> } {
  if (!msa || !contracts.includes(MSA_SLUG)) return { include_contracts: contracts, overrides: {} };
  const include_contracts = [...new Set(contracts.map((s) => (s === MSA_SLUG ? MSA_ON_FILE_SLUG : s)))];
  return { include_contracts, overrides: { [MSA_ON_FILE_SLUG]: msaOnFileText(msa, clientName) } };
}
