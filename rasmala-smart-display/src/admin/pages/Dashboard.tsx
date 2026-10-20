import { useCallback, useEffect, useState } from 'react';
import { supabase, errMsg } from '../supabase';
import { useAuth } from '../auth';
import { useLiveSignal } from '../components/useLive';
import { LastUpdate } from '../components/LastUpdate';
import { Spinner, useToast } from '../ui';
import { displayUrl } from '../../shared/env';
import { KIND_LABEL, STATUS_LABEL } from '../../shared/labels';
import { formatTime, gregorianLong, riyadhParts, riyadhToday, toMinutes, weekdayName } from '../../shared/time';
import type { DayContent, Task } from '../../shared/types';

export function Dashboard() {
  const auth = useAuth();
  const toast = useToast();
  const [today] = useState(riyadhToday());
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [day, setDay] = useState<DayContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, d] = await Promise.all([
      supabase.from('tasks').select('*').eq('task_date', today).order('sort_order').order('start_time'),
      supabase.from('day_content').select('*').eq('day', today).maybeSingle(),
    ]);
    if (t.error) { setError(errMsg(t.error)); return; }
    setError(null);
    setTasks(t.data as Task[]);
    setDay((d.data as DayContent) || null);
  }, [today]);

  useEffect(() => { load(); }, [load]);
  useLiveSignal(load);

  const visible = (tasks || []).filter((t) => t.is_visible);
  const work = visible.filter((t) => t.kind === 'task' || t.kind === 'meeting');
  const count = (s: Task['status']) => work.filter((t) => t.status === s).length;
  const done = count('done');
  const pct = work.length ? Math.round((done / work.length) * 100) : 0;

  const p = riyadhParts();
  const mins = p.hh * 60 + p.mm;
  const current = visible.find((t) => {
    const s = toMinutes(t.start_time); const e = toMinutes(t.end_time);
    return s !== null && mins >= s && (e === null ? mins < s + 30 : mins < e);
  });
  const next = visible.find((t) => { const s = toMinutes(t.start_time); return s !== null && s > mins; });

  async function copyLink() {
    try { await navigator.clipboard.writeText(displayUrl()); toast.ok('تم نسخ رابط شاشة العرض'); }
    catch { toast.info(displayUrl()); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>مرحبًا {auth.profile?.full_name || ''}</h1>
          <p className="muted">{weekdayName(today)} — {gregorianLong(today)}</p>
        </div>
        <div className="row-actions">
          <a className="btn btn-primary" href={`#/schedule?date=${today}`}>تعديل جدول اليوم</a>
          <button className="btn" onClick={copyLink}>نسخ رابط العرض</button>
        </div>
      </div>

      {error && <div className="note note-err">{error}</div>}
      {!tasks && !error && <Spinner label="جارٍ تحميل ملخص اليوم…" />}

      {tasks && (
        <>
          <div className="stats">
            <div className="stat"><b>{work.length}</b><span>مهام واجتماعات</span></div>
            <div className="stat ok"><b>{done}</b><span>مكتملة</span></div>
            <div className="stat prog"><b>{count('in_progress')}</b><span>قيد التنفيذ</span></div>
            <div className="stat warn"><b>{count('postponed')}</b><span>مؤجلة</span></div>
          </div>

          <div className="card">
            <div className="progress-head"><b>نسبة الإنجاز</b><span>{pct}%</span></div>
            <div className="progress"><span style={{ width: pct + '%' }} /></div>
          </div>

          <div className="grid-2">
            <div className="card">
              <h2>الآن وما بعده</h2>
              {current ? (
                <div className="now-item">
                  <span className="badge badge-gold">الآن</span>
                  <b>{current.title}</b>
                  <span className="muted">{formatTime(current.start_time)} – {formatTime(current.end_time)}</span>
                </div>
              ) : <p className="muted">لا توجد مهمة جارية في هذا الوقت.</p>}
              {next && (
                <div className="now-item">
                  <span className="badge">التالي</span>
                  <b>{next.title}</b>
                  <span className="muted">{formatTime(next.start_time)} · {KIND_LABEL[next.kind]} · {STATUS_LABEL[next.status]}</span>
                </div>
              )}
              {!visible.length && <p className="muted">لا توجد مهام لهذا اليوم بعد. <a href={`#/schedule?date=${today}`}>أضف مهام</a> أو طبّق قالبًا.</p>}
            </div>

            <div className="card">
              <h2>أهم 3 أولويات اليوم</h2>
              {day?.priorities?.filter(Boolean).length ? (
                <ol className="prio-ol">{day.priorities.filter(Boolean).map((x, i) => <li key={i}>{x}</li>)}</ol>
              ) : <p className="muted">لم تُحدد الأولويات بعد.</p>}
              {day?.notes && <p className="dash-notes">{day.notes}</p>}
            </div>
          </div>

          <div className="card">
            <h2>آخر تحديث للمحتوى</h2>
            <LastUpdate />
          </div>
        </>
      )}
    </div>
  );
}
