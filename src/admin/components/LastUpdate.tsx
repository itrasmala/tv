import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { formatStamp, riyadhToday } from '../../shared/time';
import { ACTION_LABEL, ENTITY_LABEL } from '../../shared/labels';

interface Last { at: string; actor_name: string | null; actor_email: string | null; entity: string; action: string; summary: string | null; }

/** آخر وقت تحديث واسم من قام به */
export function LastUpdate({ refreshKey = 0, compact = false }: { refreshKey?: number; compact?: boolean }) {
  const [last, setLast] = useState<Last | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    supabase.rpc('get_last_update').then(({ data }) => {
      if (alive) setLast(((data as Last[] | null) || [])[0] || null);
    });
    return () => { alive = false; };
  }, [refreshKey, tick]);

  useEffect(() => {
    const ch = supabase
      .channel('admin-last-update-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screen_signal' }, () => setTick((t) => t + 1))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  if (!last) return compact ? null : <span className="muted">لا توجد تعديلات مسجلة بعد</span>;
  const who = last.actor_name || last.actor_email || 'النظام';
  if (compact) {
    const sameDay = riyadhToday(Date.parse(last.at)) === riyadhToday();
    return <span className="last-upd" title={`${formatStamp(last.at)} — ${who}`}>آخر تحديث {formatStamp(last.at, !sameDay)} بواسطة {who}</span>;
  }
  return (
    <div className="last-upd-card">
      <div className="lu-time">{formatStamp(last.at)}</div>
      <div className="lu-who">بواسطة <b>{who}</b></div>
      <div className="lu-what muted">
        {ACTION_LABEL[last.action] || last.action} {ENTITY_LABEL[last.entity] || last.entity}
        {last.summary ? ` — ${last.summary}` : ''}
      </div>
    </div>
  );
}
