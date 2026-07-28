import { useState } from 'react';
import { supabase } from '../../lib/supabase';

/**
 * Local development sign-in, so UI work can be checked against real data
 * instead of only by hand. Rendered behind `import.meta.env.DEV`, and it talks
 * to a Vite middleware that only exists on the dev server, so this button is
 * dead code in a production build even if it were somehow rendered.
 *
 * The session it gets belongs to whichever account DEV_LOGIN_EMAIL names. Give
 * that profile a role other than admin or auditor and the row-level security
 * policies make it read-only: reads pass because they only require a profile to
 * exist, writes fail because they require one of those two roles.
 */
export default function DevSignIn() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/__dev_login', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? 'Dev sign-in failed');
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      });
      if (sessionError) throw sessionError;
      // Full reload so every provider picks the session up from scratch.
      window.location.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dev sign-in failed');
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Local development</p>
      <button
        type="button"
        onClick={signIn}
        disabled={busy}
        className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Dev sign-in (read-only)'}
      </button>
      {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
      <p className="mt-2 text-[11px] text-gray-400">
        Dev server only. Never part of a production build.
      </p>
    </div>
  );
}
