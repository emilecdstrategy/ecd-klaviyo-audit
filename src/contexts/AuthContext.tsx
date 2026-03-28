import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Profile, UserRole } from '../lib/types';

interface AuthState {
  user: Profile | null;
  isLoading: boolean;
  authError: string;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  hasRole: (role: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const ADMIN_DOMAIN = 'ecdigitalstrategy.com';

  useEffect(() => {
    let isMounted = true;

    const handleSessionUser = async (sessionUser: { id: string; email?: string | null }) => {
      const email = (sessionUser.email ?? '').toLowerCase().trim();

      const { data: existing, error: profileErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', sessionUser.id)
        .maybeSingle();

      if (!isMounted) return;
      if (profileErr) {
        setAuthError(profileErr.message);
        return;
      }

      if (existing) {
        setUser(existing);
        setAuthError('');
        return;
      }

      const isEcdEmail = email.endsWith(`@${ADMIN_DOMAIN}`);
      if (!isEcdEmail) {
        setAuthError('Your account has not been set up yet. Please contact the ECD team.');
        await supabase.auth.signOut();
        if (!isMounted) return;
        setUser(null);
        return;
      }

      const defaultName = (email.split('@')[0] || '').replace(/\./g, ' ').trim();
      const { data: created, error: insertErr } = await supabase
        .from('profiles')
        .insert({
          id: sessionUser.id,
          name: defaultName,
          email,
          role: 'admin',
        })
        .select('*')
        .single();

      if (!isMounted) return;
      if (insertErr) {
        setAuthError(insertErr.message);
        return;
      }

      setUser(created);
      setAuthError('');
    };

    const init = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (error) setAuthError(error.message);

      const sessionUser = data.session?.user
        ? { id: data.session.user.id, email: data.session.user.email }
        : null;

      if (sessionUser) {
        await handleSessionUser(sessionUser);
      }
      if (isMounted) setIsLoading(false);
    };

    void init();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void handleSessionUser({ id: session.user.id, email: session.user.email });
      } else {
        setUser(null);
      }
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const sendMagicLink = async (email: string) => {
    const trimmed = email.trim().toLowerCase();
    setAuthError('');

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: true,
      },
    });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const hasRole = (role: UserRole | UserRole[]) => {
    if (!user) return false;
    const roles = Array.isArray(role) ? role : [role];
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, authError, sendMagicLink, signOut, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
