import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';

/** يستدعي onChange عند أي تعديل على بيانات الشاشة (من أي مستخدم) — مع تأخير بسيط لدمج التغييرات */
export function useLiveSignal(onChange: () => void) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const ch = supabase
      .channel('admin-live-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screen_signal' }, () => {
        clearTimeout(t);
        t = setTimeout(() => cb.current(), 700);
      })
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, []);
}
