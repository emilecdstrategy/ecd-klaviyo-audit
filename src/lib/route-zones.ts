// Enforces two "zones" in production: everything under /proposals lives on
// proposal.ecdigitalstrategy.com, everything else (dashboard, audits, clients,
// admin) lives on audit.ecdigitalstrategy.com. The app is the same SPA on both
// domains, so ordinary client-side routing can't move between origins on its
// own -- this does an actual cross-origin redirect when the current path
// doesn't belong on the current domain.
const PROPOSAL_ORIGIN = 'https://proposal.ecdigitalstrategy.com';
const AUDIT_ORIGIN = 'https://audit.ecdigitalstrategy.com';
const PROD_ROOT_DOMAIN = 'ecdigitalstrategy.com';

function isProposalZonePath(pathname: string): boolean {
  return pathname === '/proposals' || pathname.startsWith('/proposals/');
}

// Public share links (/report/:token, /proposal/:token) and /login are neutral:
// the report/proposal links already carry the right domain from how they were
// generated (see public-origin.ts), and login doesn't belong to either zone.
function isZonedPath(pathname: string): boolean {
  return (
    !pathname.startsWith('/report/') &&
    !pathname.startsWith('/proposal/') &&
    pathname !== '/login'
  );
}

/** Returns the origin `pathname` should be served from, or null if the current
 * domain is already correct, zoning doesn't apply to this path, or we're
 * outside production (localhost, Netlify deploy previews). */
export function getZoneRedirectOrigin(pathname: string): string | null {
  if (typeof window === 'undefined') return null;
  const { hostname, origin } = window.location;
  if (!hostname.endsWith(PROD_ROOT_DOMAIN)) return null;
  if (!isZonedPath(pathname)) return null;

  const targetOrigin = isProposalZonePath(pathname) ? PROPOSAL_ORIGIN : AUDIT_ORIGIN;
  return targetOrigin === origin ? null : targetOrigin;
}
