import type { Profile } from './types';
import { canAccessArea } from './access';

/**
 * Who can create and open web audits.
 *
 * This was an email allowlist of one while the feature was being built. It is
 * finished, so web audits are now simply audits: they follow the Audits area
 * exactly like Klaviyo audits do, which means an admin always has them and a
 * Member has them unless that checkbox is cleared in Settings.
 *
 * Kept as its own function rather than folded into canAccessArea at the call
 * sites, because "can this person use web audits" is worth being able to answer
 * in one place if it ever diverges again.
 */
export function canUseWebAudits(user: Profile | null | undefined): boolean {
  return canAccessArea(user, 'audits');
}
