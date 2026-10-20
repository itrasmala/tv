import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile } from '../shared/types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  profileError: string | null;
  isAdmin: boolean;
  canEdit: boolean;
  canVideos: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const loadProfile = useCallback(async (s: Session | null) => {
    if (!s) { setProfile(null); setProfileError(null); return; }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
    if (error) { setProfile(null); setProfileError('تعذّر تحميل بيانات حسابك.'); return; }
    if (!data) { setProfile(null); setProfileError('لا يوجد ملف صلاحيات لهذا الحساب. تواصل مع المدير العام.'); return; }
    if (!data.is_active) { setProfile(null); setProfileError('هذا الحساب معطّل. تواصل مع المدير العام.'); return; }
    setProfileError(null);
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadProfile(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // تأجيل الاستعلام خارج معالج الحدث كما توصي Supabase
        setTimeout(() => { loadProfile(s); }, 0);
      }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const value = useMemo<AuthState>(() => {
    const role = profile?.role;
    return {
      loading,
      session,
      profile,
      profileError,
      isAdmin: role === 'admin',
      canEdit: role === 'admin' || role === 'editor',
      canVideos: role === 'admin' || (role === 'editor' && !!profile?.can_manage_videos),
      refreshProfile: () => loadProfile(session),
      signOut: async () => { await supabase.auth.signOut(); setProfile(null); },
    };
  }, [loading, session, profile, profileError, loadProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}
