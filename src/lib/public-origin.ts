// Client-facing proposal links (copy-link, email CTA) always point at the
// dedicated proposal subdomain regardless of which internal subdomain (e.g.
// audit.ecdigitalstrategy.com) a staff member happens to be using when they
// trigger the send/copy -- so a client never sees an inconsistent domain.
// Falls back to the current origin outside production (localhost, Netlify
// deploy previews) so local dev and preview builds aren't redirected to prod.
const PRODUCTION_ROOT_DOMAIN = 'ecdigitalstrategy.com';
const PROPOSAL_PUBLIC_ORIGIN = 'https://proposal.ecdigitalstrategy.com';
const DOCUMENT_PUBLIC_ORIGIN = 'https://docs.ecdigitalstrategy.com';
const REPORT_PUBLIC_ORIGIN = 'https://audit.ecdigitalstrategy.com';

export function publicProposalOrigin(): string {
  if (typeof window === 'undefined') return PROPOSAL_PUBLIC_ORIGIN;
  return window.location.hostname.endsWith(PRODUCTION_ROOT_DOMAIN)
    ? PROPOSAL_PUBLIC_ORIGIN
    : window.location.origin;
}

/** Client-facing document signing links point at the dedicated docs subdomain,
 * regardless of which internal subdomain a staff member is on. */
export function publicDocumentOrigin(): string {
  if (typeof window === 'undefined') return DOCUMENT_PUBLIC_ORIGIN;
  return window.location.hostname.endsWith(PRODUCTION_ROOT_DOMAIN)
    ? DOCUMENT_PUBLIC_ORIGIN
    : window.location.origin;
}

/** Client-facing audit report links. Shared reports are served from the audit
 * subdomain, so a proposal that points back at its audit uses the same host the
 * client was given when the report was shared. */
export function publicReportOrigin(): string {
  if (typeof window === 'undefined') return REPORT_PUBLIC_ORIGIN;
  return window.location.hostname.endsWith(PRODUCTION_ROOT_DOMAIN)
    ? REPORT_PUBLIC_ORIGIN
    : window.location.origin;
}
