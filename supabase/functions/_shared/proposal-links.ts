export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Hyperlinked "Proposal ECD-0004 ("Title")" reference for team notification emails,
 * pointing at the internal (staff-auth) proposal detail page. */
export function proposalReferenceLink(
  origin: string,
  proposal: { id: string; proposal_number: number; title: string },
): string {
  const label = `Proposal ECD-${String(proposal.proposal_number).padStart(4, "0")} (“${escapeHtml(proposal.title)}”)`;
  if (!origin) return label;
  const href = `${origin}/proposals/${proposal.id}`;
  return `<a href="${href}" style="color:#4b3afe;text-decoration:underline;">${label}</a>`;
}
