// Web audits are still a work in progress, so they are locked to a small allowlist
// while the feature is finished. Everyone else sees a "work in progress" state and
// cannot create or preview web audits.
const WEB_AUDIT_ALLOWED_EMAILS = ['emil@ecdigitalstrategy.com'];

export function canUseWebAudits(user: { email?: string | null } | null | undefined): boolean {
  const email = (user?.email ?? '').toLowerCase().trim();
  return WEB_AUDIT_ALLOWED_EMAILS.includes(email);
}
