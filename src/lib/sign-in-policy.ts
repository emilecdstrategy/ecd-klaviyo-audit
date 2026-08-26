/**
 * Who is allowed to sign in at all.
 *
 * The magic-link box used to create an account for whatever address was typed
 * into it, so three strangers ended up with accounts on the platform: two at
 * biolabfarma.com.br and one at exzell.com, none of them invited. They could
 * not read anything, since RLS keys off a profile row they did not have, but
 * they were authenticated, and a handful of functions used to accept anyone
 * authenticated.
 *
 * Two rules now, and both are enforced again in the database (see the
 * restrict_sign_in migration) because a client-side check is a courtesy, not a
 * boundary:
 *
 *  1. The address is on the agency's domain.
 *  2. The account already exists, which means somebody invited it.
 */
export const SIGN_IN_DOMAINS = ['ecdigitalstrategy.com'];

export function isAllowedSignInEmail(email: string): boolean {
  const address = (email ?? '').trim().toLowerCase();
  const at = address.lastIndexOf('@');
  if (at < 1) return false;
  return SIGN_IN_DOMAINS.includes(address.slice(at + 1));
}

/** What to tell someone whose magic link was refused.
 *
 * Supabase answers an unknown address with "Signups not allowed for otp", which
 * is true and tells the reader nothing. Both refusals mean the same thing in
 * practice: ask an admin to invite you. */
export function signInErrorMessage(raw: string): string {
  if (/signups? not allowed|user not found|invalid login/i.test(raw)) {
    return 'That address has not been invited yet. Ask an admin to invite you from Settings, then try again.';
  }
  if (/rate limit|too many/i.test(raw)) {
    return 'Too many sign-in emails just went out. Wait a minute and try again.';
  }
  return raw;
}
