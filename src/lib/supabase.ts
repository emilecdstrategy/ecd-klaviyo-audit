import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY)',
  );
}

// Cookie-backed session (instead of the default localStorage, which is isolated
// per subdomain) scoped to the whole *.ecdigitalstrategy.com domain, so signing
// in on one ECD subdomain (e.g. audit.ecdigitalstrategy.com) carries over to
// another (e.g. proposal.ecdigitalstrategy.com) instead of requiring a second
// login. Falls back to a host-scoped cookie outside production (localhost,
// Netlify deploy previews), where a domain-wide cookie wouldn't resolve.
const isProdRootDomain =
  typeof window !== 'undefined' && window.location.hostname.endsWith('ecdigitalstrategy.com');

export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey, {
  cookieOptions: {
    domain: isProdRootDomain ? '.ecdigitalstrategy.com' : undefined,
    path: '/',
    sameSite: 'lax',
    secure: typeof window !== 'undefined' && window.location.protocol === 'https:',
    maxAge: 60 * 60 * 24 * 365,
  },
});
