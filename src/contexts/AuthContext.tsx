import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { DEMO_USER } from '../lib/demo-data';
import type { Profile, UserRole } from '../lib/types';

interface AuthState {
  user: Profile | null;
  isDemo: boolean;
  isLoading: boolean;
  authError: string;
  sendMagicLink: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  enterDemo: () => void;
  exitDemo: () => void;
  hasRole: (role: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [isDemo, setIsDemo] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const allowedDomain = 'ecdigitalstrategy.com';
  const isAllowedEmail = (email?: string | null) => {
    if (!email) return false;
    const lower = email.toLowerCase().trim();
    return lower.endsWith(`@${allowedDomain}`);
  };

  useEffect(() => {
    const stored = localStorage.getItem('ecd-demo-mode');
    if (stored === 'false') {
      setIsDemo(false);
    } else {
      setUser(DEMO_USER);
      setIsDemo(true);
    }

    supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        (async () => {
          const email = session.user.email ?? '';
          if (!isAllowedEmail(email)) {
            setAuthError(`Only @${allowedDomain} accounts are allowed.`);
            await supabase.auth.signOut();
            setUser(null);
            setIsDemo(false);
            localStorage.setItem('ecd-demo-mode', 'false');
            return;
          }

          const { data: existing, error: profileErr } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();

          if (profileErr) {
            setAuthError(profileErr.message);
            return;
          }

          if (existing) {
            setUser(existing);
            setIsDemo(false);
            localStorage.setItem('ecd-demo-mode', 'false');
            setAuthError('');
            return;
          }

          const defaultName = (email.split('@')[0] || '').replace(/\./g, ' ').trim();
          const { data: created, error: insertErr } = await supabase
            .from('profiles')
            .insert({
              id: session.user.id,
              name: defaultName,
              email,
              role: 'auditor',
            })
            .select('*')
            .single();

          if (insertErr) {
            setAuthError(insertErr.message);
            return;
          }

          setUser(created);
          setIsDemo(false);
          localStorage.setItem('ecd-demo-mode', 'false');
          setAuthError('');
        })();
      } else if (!isDemo) {
        setUser(null);
      }
    });

    setIsLoading(false);
  }, []);

  const sendMagicLink = async (email: string) => {
    const trimmed = email.trim().toLowerCase();
    setAuthError('');
    if (!isAllowedEmail(trimmed)) {
      throw new Error(`Only @${allowedDomain} accounts are allowed.`);
    }

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
    setIsDemo(false);
    localStorage.setItem('ecd-demo-mode', 'false');
  };

  const enterDemo = () => {
    setUser(DEMO_USER);
    setIsDemo(true);
    localStorage.setItem('ecd-demo-mode', 'true');
  };

  const exitDemo = () => {
    setUser(null);
    setIsDemo(false);
    localStorage.setItem('ecd-demo-mode', 'false');
  };

  const hasRole = (role: UserRole | UserRole[]) => {
    if (!user) return false;
    const roles = Array.isArray(role) ? role : [role];
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ user, isDemo, isLoading, authError, sendMagicLink, signOut, enterDemo, exitDemo, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
