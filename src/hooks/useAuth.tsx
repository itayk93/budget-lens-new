import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  profile: { id: string; email: string; full_name: string; gender: 'male' | 'female' | 'neutral' } | null;
  isAdmin: boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AuthContextType['profile']>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (u: User) => {
    try {
      const { data } = await supabase
        .from('app_users' as any)
        .select('*')
        .eq('user_id', u.id)
        .maybeSingle();

      if (data) {
        setProfile({
          id: data.user_id || u.id,
          email: data.email || u.email || '',
          full_name: data.email?.split('@')[0] || u.email || '',
          gender: 'neutral',
        });
        setIsAdmin(data.role === 'owner' || data.role === 'admin');
      } else {
        setProfile({
          id: u.id,
          email: u.email || '',
          full_name: u.email || '',
          gender: 'neutral',
        });
        setIsAdmin(false);
      }
    } catch {
      // Ignore if query fails
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          setTimeout(() => fetchProfile(session.user), 0);
        } else {
          setUser(null);
          setProfile(null);
          setIsAdmin(false);
        }
        setLoading(false);
      }
    );

    let active = true;

    const sessionDeadline = window.setTimeout(() => {
      if (active) setLoading(false);
    }, 10_000);

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!active) return;
        if (session?.user) {
          setUser(session.user);
          void fetchProfile(session.user);
        }
      })
      .catch((error) => {
        console.error("[auth] Session restore failed", error);
      })
      .finally(() => {
        window.clearTimeout(sessionDeadline);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      window.clearTimeout(sessionDeadline);
      subscription.unsubscribe();
    };

  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, profile, isAdmin, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
