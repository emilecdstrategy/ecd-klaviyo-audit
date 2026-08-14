import type { AppArea, Profile } from './types';

/** Per-user area access, the one place the rules live.
 *
 * The model, as decided with Emil (2026-08-14):
 * - Admins can do everything, including managing users; their checkboxes are
 *   ignored so an admin can never lock themselves out of an area.
 * - Members (role 'auditor' in the database) work in whichever of the three
 *   areas their app_access grants: audits, proposals, documents.
 * - Clients, the Dashboard, the Line Item Catalog and API Connection are open
 *   to every staff account and are deliberately NOT represented here.
 * - Web audits keep their separate email allowlist (web-audit-access.ts); an
 *   Audits checkbox grants Klaviyo audits, not web audits.
 *
 * A missing app_access, or a missing key inside it, means ALLOWED: the column
 * default grants all three areas, rows predating the column have null, and
 * treating absence as denial would have locked the whole team out on deploy.
 */
export function canAccessArea(user: Profile | null | undefined, area: AppArea): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'viewer') return false;
  return user.app_access?.[area] !== false;
}

/** The Users tab and the admin_users function: admins only. */
export function canManageUsers(user: Profile | null | undefined): boolean {
  return user?.role === 'admin';
}

export const ALL_AREAS: AppArea[] = ['audits', 'proposals', 'documents'];

export const AREA_LABELS: Record<AppArea, string> = {
  audits: 'Audits',
  proposals: 'Proposals',
  documents: 'Documents',
};
