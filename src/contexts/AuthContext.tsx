import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { DEMO_USER } from '../lib/demo-data';
import type { Profile, UserRole } from '../lib/types';

interface AuthState {
  user: Profile | null;
  isDemo: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
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
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle();
          if (data) {
            setUser(data);
            setIsDemo(false);
            localStorage.setItem('ecd-demo-mode', 'false');
          }
        })();
      } else if (!isDemo) {
        setUser(null);
      }
    });

    setIsLoading(false);
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signUp = async (email: string, password: string, name: string) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    if (data.user) {
      await supabase.from('profiles').insert({
        id: data.user.id,
        name,
        email,
        role: 'auditor',
      });
    }
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
    <AuthContext.Provider value={{ user, isDemo, isLoading, signIn, signUp, signOut, enterDemo, exitDemo, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
