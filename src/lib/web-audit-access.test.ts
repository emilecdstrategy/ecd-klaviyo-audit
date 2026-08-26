/**
 * @vitest-environment node
 *
 * Web audits were locked to a single email while the feature was being built.
 * They now follow the Audits area like every other audit, so this pins who gets
 * them, using the roles the team actually holds.
 */
import { describe, expect, it } from 'vitest';
import { canUseWebAudits } from './web-audit-access';
import type { Profile } from './types';

const person = (role: string, app_access?: Record<string, boolean>) =>
  ({ id: 'x', email: 'someone@ecdigitalstrategy.com', name: 'Someone', role, app_access } as unknown as Profile);

describe('canUseWebAudits', () => {
  it('lets an admin in whatever their checkboxes say', () => {
    expect(canUseWebAudits(person('admin', { audits: false, proposals: true, documents: true }))).toBe(true);
  });

  it('lets a member with the Audits area in', () => {
    // Every member on the team today is in this shape.
    expect(canUseWebAudits(person('auditor', { audits: true, proposals: true, documents: false }))).toBe(true);
  });

  it('keeps a member out when Audits is unchecked', () => {
    expect(canUseWebAudits(person('auditor', { audits: false, proposals: true, documents: true }))).toBe(false);
  });

  it('treats a missing app_access as allowed, like the rest of the app', () => {
    // Rows predating the column have null, and denying them would lock people out.
    expect(canUseWebAudits(person('auditor'))).toBe(true);
  });

  it('keeps signed-out visitors and legacy viewers out', () => {
    expect(canUseWebAudits(null)).toBe(false);
    expect(canUseWebAudits(person('viewer', { audits: true }))).toBe(false);
  });

  it('no longer depends on the email address', () => {
    // The old rule was a hardcoded list containing one person.
    const other = { ...person('auditor', { audits: true }), email: 'anyone@ecdigitalstrategy.com' } as Profile;
    expect(canUseWebAudits(other)).toBe(true);
  });
});
