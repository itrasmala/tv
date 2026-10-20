import { useCallback, useEffect, useState } from 'react';
import { supabase, errMsg, ensureRows } from '../supabase';
import { useAuth } from '../auth';
import { navigate } from '../router';
import { Empty, Field, Modal, ReadOnlyNote, Spinner, useConfirm, useToast } from '../ui';
import { KIND_LABEL } from '../../shared/labels';
import { formatStamp, formatTime, riyadhToday, addDays } from '../../shared/time';
import type { Template } from '../../shared/types';

export function Templates() {
  const { canEdit } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [list, setList] = useState<Template[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [applying, setApplying] = useState<Template | null>(null);
  const [renaming, setRenaming] = useState<Template | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('templates').select('*').order('name');
    if (error) { toast.err(errMsg(error)); setList([]); return; }
    setList(data as Template[]);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function remove(t: Template) {
    if (!(await confirm({ title: 'حذف قالب', text: `هل تريد حذف القالب «${t.name}»؟ لن تتأثر الجداول التي طُبّق عليها سابقًا.`, confirmText: 'حذف', danger: true }))) return;
    const { data, error } = await supabase.from('templates').delete().eq('id', t.id).select();
    if (error) return toast.err(errMsg(error));
    try { ensureRows(data); } catch (e) { return toast.err(errMsg(e)); }
    toast.ok('تم حذف القالب');
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>قوالب الجداول</h1>
          <p className="muted">احفظ جدولًا متكررًا مرة واحدة وطبّقه على أي يوم. لإنشاء قالب: افتح «جدول المهام» ثم «حفظ كقالب».</p>
        </div>
      </div>
      {!canEdit && <ReadOnlyNote />}
      {!list && <Spinner />}
      {list && !list.length && <Empty>لا توجد قوالب بعد.</Empty>}
      {list && list.map((t) => (
        <div key={t.id} className="card tpl-card">
          <div className="card-head">
            <div>
              <h2>{t.name}</h2>
              <div className="muted small">{t.items.length} مهمة · آخر تعديل {formatStamp(t.updated_at)}</div>
            </div>
            <div className="row-actions">
              <button className="btn" onClick={() => setOpen(open === t.id ? null : t.id)}>{open === t.id ? 'إخفاء التفاصيل' : 'عرض التفاصيل'}</button>
              {canEdit && <>
                <button className="btn btn-primary" onClick={() => setApplying(t)}>تطبيق على يوم</button>
                <button className="btn btn-ghost" onClick={() => setRenaming(t)}>إعادة تسمية</button>
                <button className="btn btn-ghost danger" onClick={() => remove(t)}>حذف</button>
              </>}
            </div>
          </div>
          {open === t.id && (
            <div className="tpl-detail">
              <ul className="tpl-items">
                {t.items.map((it, i) => (
                  <li key={i}><b>{formatTime(it.start_time) || '—'}{it.end_time ? ` – ${formatTime(it.end_time)}` : ''}</b> {it.title}
                    {it.kind !== 'task' && <span className={`badge kind-${it.kind}`}>{KIND_LABEL[it.kind]}</span>}
                    {it.assignee && <span className="muted"> · {it.assignee}</span>}
                  </li>
                ))}
              </ul>
              {t.priorities.length > 0 && <p><b>الأولويات:</b> {t.priorities.join(' · ')}</p>}
              {t.notes && <p><b>الملاحظات:</b> {t.notes}</p>}
            </div>
          )}
        </div>
      ))}
      {applying && <ApplyModal tpl={applying} onClose={() => setApplying(null)} />}
      {renaming && <RenameModal tpl={renaming} onClose={() => setRenaming(null)} onDone={() => { setRenaming(null); load(); }} />}
    </div>
  );
}

function ApplyModal({ tpl, onClose }: { tpl: Template; onClose: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState(addDays(riyadhToday(), 1));
  const [mode, setMode] = useState<'append' | 'replace'>('replace');
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const { data, error } = await supabase.rpc('apply_template', { p_template: tpl.id, p_date: date, p_mode: mode, p_include_day: true });
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    toast.ok(`تم تطبيق القالب (${data ?? 0} مهمة)`);
    navigate('/schedule', { date });
  }
  return (
    <Modal title={`تطبيق «${tpl.name}»`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>إلغاء</button>
      <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'جارٍ التطبيق…' : 'تطبيق'}</button>
    </>}>
      <Field label="على تاريخ"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <div className="radio-group">
        <label><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> استبدال مهام ذلك اليوم إن وجدت</label>
        <label><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> إضافة إلى مهام ذلك اليوم</label>
      </div>
    </Modal>
  );
}

function RenameModal({ tpl, onClose, onDone }: { tpl: Template; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(tpl.name);
  const [busy, setBusy] = useState(false);
  async function run() {
    const n = name.trim();
    if (!n || n.length > 80) return toast.err('أدخل اسمًا صالحًا (حتى 80 حرفًا)');
    setBusy(true);
    const { data, error } = await supabase.from('templates').update({ name: n }).eq('id', tpl.id).select();
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    try { ensureRows(data); } catch (e) { return toast.err(errMsg(e)); }
    toast.ok('تم تغيير الاسم');
    onDone();
  }
  return (
    <Modal title="إعادة تسمية القالب" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>إلغاء</button>
      <button className="btn btn-primary" onClick={run} disabled={busy}>حفظ</button>
    </>}>
      <Field label="الاسم"><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}
