import { Fragment, useCallback, useEffect, useState } from 'react';
import { supabase, errMsg } from '../supabase';
import { Spinner } from '../ui';
import { ACTION_LABEL, ENTITY_LABEL, KIND_LABEL, STATUS_LABEL } from '../../shared/labels';
import { formatStamp } from '../../shared/time';
import type { AuditEntry } from '../../shared/types';

const PAGE = 50;
const HIDDEN_FIELDS = new Set(['updated_at', 'updated_by', 'created_at', 'id']);
const FIELD_LABEL: Record<string, string> = {
  title: 'العنوان', start_time: 'البداية', end_time: 'النهاية', assignee: 'المسؤول', notes: 'الملاحظات',
  status: 'الحالة', kind: 'النوع', sort_order: 'الترتيب', is_visible: 'الظهور', task_date: 'التاريخ',
  priorities: 'الأولويات', url: 'رابط الفيديو', fit: 'طريقة العرض', poster_url: 'الصورة الاحتياطية', enabled: 'التفعيل',
  role: 'الدور', is_active: 'نشط', can_manage_videos: 'صلاحية الفيديو', full_name: 'الاسم', name: 'الاسم', items: 'عناصر القالب',
  split_right: 'نسبة اليمين', split_center: 'نسبة الوسط', split_left: 'نسبة اليسار', logo_url: 'الشعار', org_name: 'اسم المؤسسة',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (typeof v === 'string') return STATUS_LABEL[v as keyof typeof STATUS_LABEL] || KIND_LABEL[v as keyof typeof KIND_LABEL] || v;
  if (Array.isArray(v)) return v.length > 5 ? `${v.length} عنصر` : v.map(show).join('، ');
  return JSON.stringify(v).slice(0, 120);
}

function changes(e: AuditEntry): [string, string, string][] {
  const o = e.old_data || {};
  const n = e.new_data || {};
  const keys = Array.from(new Set([...Object.keys(o), ...Object.keys(n)])).filter((k) => !HIDDEN_FIELDS.has(k));
  if (e.action === 'update') return keys.filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k])).map((k) => [FIELD_LABEL[k] || k, show(o[k]), show(n[k])]);
  const src = e.action === 'insert' ? n : o;
  return keys.filter((k) => src[k] !== null && src[k] !== '' && k !== 'email').slice(0, 10).map((k) => [FIELD_LABEL[k] || k, e.action === 'delete' ? show(src[k]) : '', e.action === 'insert' ? show(src[k]) : '']);
}

export function Audit() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    let q = supabase.from('audit_log').select('*').order('at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
    if (entity) q = q.eq('entity', entity);
    if (action) q = q.eq('action', action);
    if (from) q = q.gte('at', `${from}T00:00:00+03:00`);
    if (to) q = q.lte('at', `${to}T23:59:59+03:00`);
    const { data, error: err } = await q;
    if (err) { setError(errMsg(err)); setRows([]); return; }
    setError(null);
    setHasMore((data || []).length > PAGE);
    setRows((data as AuditEntry[]).slice(0, PAGE));
  }, [page, entity, action, from, to]);
  useEffect(() => { load(); }, [load]);

  const reset = () => setPage(0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>سجل التدقيق</h1>
          <p className="muted">كل إضافة وتعديل وحذف، ومن قام بها ومتى. لا يمكن تعديل هذا السجل أو حذفه من اللوحة.</p>
        </div>
        <button className="btn" onClick={load}>تحديث</button>
      </div>
      <div className="card filters">
        <select value={entity} onChange={(e) => { setEntity(e.target.value); reset(); }}>
          <option value="">كل العناصر</option>
          {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={action} onChange={(e) => { setAction(e.target.value); reset(); }}>
          <option value="">كل العمليات</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label>من <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reset(); }} /></label>
        <label>إلى <input type="date" value={to} onChange={(e) => { setTo(e.target.value); reset(); }} /></label>
      </div>
      {error && <div className="note note-err">{error}</div>}
      {!rows && <Spinner />}
      {rows && (
        <div className="card table-wrap">
          <table className="tbl audit">
            <thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>العنصر</th><th>الوصف</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Fragment key={r.id}>
                  <tr className="clickable" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <td className="nowrap small">{formatStamp(r.at)}</td>
                    <td>{r.actor_name || r.actor_email || 'النظام'}</td>
                    <td><span className={`badge act-${r.action}`}>{ACTION_LABEL[r.action]}</span></td>
                    <td>{ENTITY_LABEL[r.entity] || r.entity}</td>
                    <td>{r.summary || '—'} <span className="muted small">{open === r.id ? '▲' : '▼'}</span></td>
                  </tr>
                  {open === r.id && (
                    <tr className="detail-row">
                      <td colSpan={5}>
                        <table className="diff">
                          <tbody>
                            {changes(r).map(([k, a, b]) => (
                              <tr key={k}><th>{k}</th><td className="old">{a}</td><td className="new">{b}</td></tr>
                            ))}
                            {!changes(r).length && <tr><td className="muted">لا توجد تفاصيل إضافية</td></tr>}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!rows.length && <tr><td colSpan={5} className="muted">لا توجد سجلات مطابقة.</td></tr>}
            </tbody>
          </table>
          <div className="pager-row">
            <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>→ الأحدث</button>
            <span className="muted small">صفحة {page + 1}</span>
            <button className="btn btn-sm" disabled={!hasMore} onClick={() => setPage(page + 1)}>الأقدم ←</button>
          </div>
        </div>
      )}
    </div>
  );
}
