import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase, errMsg, ensureRows } from '../supabase';
import { useAuth } from '../auth';
import { navigate } from '../router';
import { useLiveSignal } from '../components/useLive';
import { ScreenPreview } from '../components/Preview';
import { Empty, Field, Modal, ReadOnlyNote, Spinner, useConfirm, useToast } from '../ui';
import { KIND_LABEL, STATUS_LABEL } from '../../shared/labels';
import { addDays, formatTime, gregorianLong, riyadhToday, toMinutes, weekdayName } from '../../shared/time';
import type { DayContent, Task, TaskKind, TaskStatus, Template } from '../../shared/types';

const STATUSES: TaskStatus[] = ['not_started', 'in_progress', 'done', 'postponed'];
const KINDS: TaskKind[] = ['task', 'meeting', 'prayer', 'break'];

export function Schedule({ date: dateParam }: { date?: string }) {
  const { canEdit } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const today = riyadhToday();
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Task> | null>(null);
  const [modal, setModal] = useState<'copy' | 'saveTpl' | 'applyTpl' | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dayDirty, setDayDirty] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('tasks').select('*').eq('task_date', date)
      .order('sort_order').order('start_time', { nullsFirst: false }).order('created_at');
    if (error) { setLoadErr(errMsg(error)); return; }
    setLoadErr(null);
    setTasks(data as Task[]);
  }, [date]);

  useEffect(() => { setTasks(null); load(); }, [load]);
  useLiveSignal(load);

  async function goTo(d: string) {
    if (dayDirty && !(await confirm({ title: 'تغييرات غير محفوظة', text: 'لديك تعديلات على الأولويات أو الملاحظات لم تُحفظ. هل تريد المتابعة وتجاهلها؟', confirmText: 'متابعة دون حفظ' }))) return;
    setDayDirty(false);
    navigate('/schedule', { date: d });
  }

  // ---------------- عمليات المهام ----------------
  async function patchTask(t: Task, patch: Partial<Task>, okText?: string) {
    setBusyId(t.id);
    const prev = tasks;
    setTasks((xs) => xs && xs.map((x) => (x.id === t.id ? { ...x, ...patch } : x)));
    const { data, error } = await supabase.from('tasks').update(patch).eq('id', t.id).select();
    setBusyId(null);
    if (error || !data?.length) {
      setTasks(prev);
      toast.err(error ? errMsg(error) : 'لم يتم الحفظ — تحقق من صلاحياتك.');
      return;
    }
    if (okText) toast.ok(okText);
  }

  async function removeTask(t: Task) {
    const ok = await confirm({ title: 'حذف مهمة', text: `هل تريد حذف «${t.title}» نهائيًا؟ لا يمكن التراجع عن هذا الإجراء.`, confirmText: 'حذف', danger: true });
    if (!ok) return;
    const { data, error } = await supabase.from('tasks').delete().eq('id', t.id).select();
    if (error) return toast.err(errMsg(error));
    try { ensureRows(data); } catch (e) { return toast.err(errMsg(e)); }
    setTasks((xs) => xs && xs.filter((x) => x.id !== t.id));
    toast.ok('تم حذف المهمة');
  }

  async function saveOrder(next: Task[], okText = 'تم تحديث الترتيب') {
    const prev = tasks;
    setTasks(next.map((t, i) => ({ ...t, sort_order: (i + 1) * 10 })));
    const { error } = await supabase.rpc('reorder_tasks', { p_ids: next.map((t) => t.id) });
    if (error) { setTasks(prev); toast.err(errMsg(error)); } else toast.ok(okText);
  }

  function move(i: number, dir: -1 | 1) {
    if (!tasks) return;
    const j = i + dir;
    if (j < 0 || j >= tasks.length) return;
    const next = tasks.slice();
    [next[i], next[j]] = [next[j], next[i]];
    saveOrder(next);
  }

  function sortByTime() {
    if (!tasks) return;
    const next = tasks.slice().sort((a, b) => (toMinutes(a.start_time) ?? 9999) - (toMinutes(b.start_time) ?? 9999));
    saveOrder(next, 'تم ترتيب المهام حسب الوقت');
  }

  function newTask() {
    const last = tasks && tasks.length ? tasks[tasks.length - 1] : null;
    setEditing({ task_date: date, title: '', start_time: last?.end_time || '08:00', end_time: null, status: 'not_started', kind: 'task', is_visible: true });
  }

  const counts = useMemo(() => {
    const xs = tasks || [];
    return { all: xs.length, done: xs.filter((t) => t.status === 'done').length, hidden: xs.filter((t) => !t.is_visible).length };
  }, [tasks]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>جدول المهام</h1>
          <p className="muted">{weekdayName(date)} — {gregorianLong(date)} {date === today && <span className="badge badge-gold">اليوم — يظهر على الشاشة</span>}</p>
        </div>
        <div className="row-actions">
          <button className="btn" onClick={() => setShowPreview((v) => !v)}>{showPreview ? 'إخفاء المعاينة' : 'معاينة الشاشة'}</button>
        </div>
      </div>

      <div className="datebar card">
        <button className="btn" onClick={() => goTo(addDays(date, -1))} aria-label="اليوم السابق">→ السابق</button>
        <input type="date" value={date} onChange={(e) => e.target.value && goTo(e.target.value)} />
        <button className="btn" onClick={() => goTo(addDays(date, 1))} aria-label="اليوم التالي">التالي ←</button>
        {date !== today && <button className="btn btn-ghost" onClick={() => goTo(today)}>العودة لليوم</button>}
      </div>

      {!canEdit && <ReadOnlyNote />}
      {showPreview && (
        <div className="card">
          <h2>معاينة شاشة العرض لهذا التاريخ</h2>
          <ScreenPreview date={date} />
          <p className="muted small">المعاينة تعرض البيانات المحفوظة حاليًا. الشاشة العامة تعرض جدول تاريخ اليوم فقط.</p>
        </div>
      )}

      <DayEditor key={date} date={date} canEdit={canEdit} onDirty={setDayDirty} />

      <div className="card">
        <div className="card-head">
          <h2>المهام <span className="muted small">({counts.all} مهمة · {counts.done} مكتملة{counts.hidden ? ` · ${counts.hidden} مخفية` : ''})</span></h2>
          {canEdit && (
            <div className="row-actions">
              <button className="btn btn-primary" onClick={newTask}>+ إضافة مهمة</button>
              <button className="btn" onClick={() => setModal('copy')}>نسخ من يوم آخر</button>
              <button className="btn" onClick={() => setModal('applyTpl')}>تطبيق قالب</button>
              <button className="btn" onClick={() => setModal('saveTpl')} disabled={!tasks?.length}>حفظ كقالب</button>
              <button className="btn btn-ghost" onClick={sortByTime} disabled={!tasks || tasks.length < 2}>ترتيب حسب الوقت</button>
            </div>
          )}
        </div>

        {loadErr && <div className="note note-err">{loadErr} <button className="btn btn-sm" onClick={load}>إعادة المحاولة</button></div>}
        {!tasks && !loadErr && <Spinner label="جارٍ تحميل المهام…" />}
        {tasks && !tasks.length && (
          <Empty>لا توجد مهام لهذا التاريخ.{canEdit && ' أضف مهمة جديدة، أو انسخ جدول يوم سابق، أو طبّق قالبًا.'}</Empty>
        )}

        {tasks && tasks.length > 0 && (
          <div className="task-list">
            {tasks.map((t, i) => (
              <div key={t.id} className={`task-row k-${t.kind} ${t.is_visible ? '' : 'is-hidden'} ${busyId === t.id ? 'busy' : ''}`}>
                {canEdit && (
                  <div className="tr-order">
                    <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="تحريك لأعلى">▲</button>
                    <button className="icon-btn" disabled={i === tasks.length - 1} onClick={() => move(i, 1)} aria-label="تحريك لأسفل">▼</button>
                  </div>
                )}
                <label className="tr-check" title={t.status === 'done' ? 'إعادة فتح المهمة' : 'تحديد كمكتملة'}>
                  <input
                    type="checkbox"
                    checked={t.status === 'done'}
                    disabled={!canEdit}
                    onChange={() => patchTask(t, { status: t.status === 'done' ? 'not_started' : 'done' }, t.status === 'done' ? 'أُعيد فتح المهمة' : 'تم تحديد المهمة كمكتملة')}
                  />
                </label>
                <div className="tr-time">
                  <b>{formatTime(t.start_time) || '—'}</b>
                  {t.end_time && <span>حتى {formatTime(t.end_time)}</span>}
                </div>
                <div className="tr-main">
                  <div className="tr-title">{t.title}</div>
                  <div className="tr-meta">
                    {t.kind !== 'task' && <span className={`badge kind-${t.kind}`}>{KIND_LABEL[t.kind]}</span>}
                    {t.assignee && <span>{t.assignee}</span>}
                    {!t.is_visible && <span className="badge">مخفية عن الشاشة</span>}
                    {t.notes && <span className="tr-notes" title={t.notes}>📝 {t.notes}</span>}
                  </div>
                </div>
                <div className="tr-status">
                  <select
                    value={t.status}
                    disabled={!canEdit}
                    className={`st st-${t.status}`}
                    onChange={(e) => patchTask(t, { status: e.target.value as TaskStatus }, 'تم تحديث الحالة')}
                    aria-label="حالة المهمة"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </div>
                {canEdit && (
                  <div className="tr-actions">
                    <button className="icon-btn" onClick={() => patchTask(t, { is_visible: !t.is_visible }, t.is_visible ? 'أُخفيت المهمة عن الشاشة' : 'أصبحت المهمة ظاهرة على الشاشة')} title={t.is_visible ? 'إخفاء عن الشاشة' : 'إظهار على الشاشة'}>
                      {t.is_visible ? '👁' : '🚫'}
                    </button>
                    <button className="icon-btn" onClick={() => setEditing(t)} title="تعديل">✎</button>
                    <button className="icon-btn danger" onClick={() => removeTask(t)} title="حذف">🗑</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <TaskForm
          initial={editing}
          nextOrder={((tasks || []).reduce((m, t) => Math.max(m, t.sort_order), 0) || 0) + 10}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {modal === 'copy' && <CopyDayModal date={date} hasTasks={!!tasks?.length} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === 'saveTpl' && <SaveTemplateModal date={date} onClose={() => setModal(null)} />}
      {modal === 'applyTpl' && <ApplyTemplateModal date={date} hasTasks={!!tasks?.length} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// الأولويات والملاحظات
// ---------------------------------------------------------------------
function DayEditor({ date, canEdit, onDirty }: { date: string; canEdit: boolean; onDirty: (v: boolean) => void }) {
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [prio, setPrio] = useState(['', '', '']);
  const [notes, setNotes] = useState('');
  const [orig, setOrig] = useState('');
  const [saving, setSaving] = useState(false);

  const snapshot = (p: string[], n: string) => JSON.stringify([p, n]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('day_content').select('*').eq('day', date).maybeSingle();
    if (error) { toast.err(errMsg(error)); return; }
    const d = data as DayContent | null;
    const p = [0, 1, 2].map((i) => d?.priorities?.[i] || '');
    setPrio(p);
    setNotes(d?.notes || '');
    setOrig(snapshot(p, d?.notes || ''));
    setLoaded(true);
  }, [date, toast]);

  useEffect(() => { load(); }, [load]);
  const dirty = loaded && snapshot(prio, notes) !== orig;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  async function save() {
    const priorities = prio.map((x) => x.trim()).filter(Boolean);
    if (priorities.some((x) => x.length > 160)) return toast.err('كل أولوية يجب ألا تتجاوز 160 حرفًا.');
    if (notes.length > 2000) return toast.err('الملاحظات يجب ألا تتجاوز 2000 حرف.');
    setSaving(true);
    const { error } = await supabase.from('day_content').upsert({ day: date, priorities, notes: notes.trim() }).select();
    setSaving(false);
    if (error) return toast.err(errMsg(error));
    setOrig(snapshot(prio, notes));
    toast.ok('تم حفظ الأولويات والملاحظات ونشرها');
  }

  if (!loaded) return <div className="card"><Spinner /></div>;

  return (
    <div className="card">
      <div className="card-head">
        <h2>أهم 3 أولويات اليوم والملاحظات</h2>
        {canEdit && (
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'جارٍ الحفظ…' : dirty ? 'حفظ ونشر' : 'محفوظ'}
          </button>
        )}
      </div>
      <div className="prio-grid">
        {prio.map((p, i) => (
          <Field key={i} label={`الأولوية ${i + 1}`}>
            <input value={p} maxLength={160} disabled={!canEdit} onChange={(e) => setPrio((xs) => xs.map((x, j) => (j === i ? e.target.value : x)))} placeholder="اكتب الأولوية…" />
          </Field>
        ))}
      </div>
      <Field label="ملاحظات اليوم" hint={`${notes.length}/2000 — تظهر أسفل الجدول على الشاشة`}>
        <textarea rows={3} value={notes} maxLength={2000} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات عامة للفريق…" />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------
// نموذج إضافة / تعديل مهمة
// ---------------------------------------------------------------------
function TaskForm({ initial, nextOrder, onClose, onSaved }: {
  initial: Partial<Task>; nextOrder: number; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const isNew = !initial.id;
  const [f, setF] = useState({
    title: initial.title || '',
    start_time: (initial.start_time || '').slice(0, 5),
    end_time: (initial.end_time || '').slice(0, 5),
    assignee: initial.assignee || '',
    notes: initial.notes || '',
    status: (initial.status || 'not_started') as TaskStatus,
    kind: (initial.kind || 'task') as TaskKind,
    is_visible: initial.is_visible !== false,
    task_date: initial.task_date || riyadhToday(),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  function validate() {
    const e: Record<string, string> = {};
    const title = f.title.trim();
    if (!title) e.title = 'عنوان المهمة مطلوب';
    else if (title.length > 200) e.title = 'العنوان طويل جدًا (الحد 200 حرف)';
    if (f.start_time && f.end_time && (toMinutes(f.end_time)! <= toMinutes(f.start_time)!)) e.end_time = 'وقت النهاية يجب أن يكون بعد وقت البداية';
    if (f.assignee.length > 100) e.assignee = 'الحد 100 حرف';
    if (f.notes.length > 1000) e.notes = 'الحد 1000 حرف';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.task_date)) e.task_date = 'تاريخ غير صالح';
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function save() {
    if (!validate()) return;
    setSaving(true);
    const row = {
      title: f.title.trim(),
      start_time: f.start_time || null,
      end_time: f.end_time || null,
      assignee: f.assignee.trim() || null,
      notes: f.notes.trim() || null,
      status: f.status,
      kind: f.kind,
      is_visible: f.is_visible,
      task_date: f.task_date,
    };
    const q = isNew
      ? supabase.from('tasks').insert({ ...row, sort_order: nextOrder }).select()
      : supabase.from('tasks').update(row).eq('id', initial.id!).select();
    const { data, error } = await q;
    setSaving(false);
    if (error) return toast.err(errMsg(error));
    if (!data?.length) return toast.err('لم يتم الحفظ — تحقق من صلاحياتك.');
    toast.ok(isNew ? 'تمت إضافة المهمة ونشرها' : 'تم حفظ التعديلات ونشرها');
    onSaved();
  }

  return (
    <Modal
      title={isNew ? 'إضافة مهمة' : 'تعديل مهمة'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ ونشر'}</button>
      </>}
    >
      <Field label="عنوان المهمة *" error={errors.title}>
        <input value={f.title} maxLength={200} onChange={(e) => set('title', e.target.value)} autoFocus />
      </Field>
      <div className="form-grid">
        <Field label="وقت البداية"><input type="time" value={f.start_time} onChange={(e) => set('start_time', e.target.value)} /></Field>
        <Field label="وقت النهاية" error={errors.end_time}><input type="time" value={f.end_time} onChange={(e) => set('end_time', e.target.value)} /></Field>
        <Field label="النوع">
          <select value={f.kind} onChange={(e) => set('kind', e.target.value as TaskKind)}>
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </Field>
        <Field label="الحالة">
          <select value={f.status} onChange={(e) => set('status', e.target.value as TaskStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </Field>
        <Field label="المسؤول (اختياري)" error={errors.assignee}>
          <input value={f.assignee} maxLength={100} onChange={(e) => set('assignee', e.target.value)} />
        </Field>
        <Field label="التاريخ" error={errors.task_date}>
          <input type="date" value={f.task_date} onChange={(e) => set('task_date', e.target.value)} />
        </Field>
      </div>
      <Field label="وصف أو ملاحظات (اختياري — لا تظهر على الشاشة)" error={errors.notes}>
        <textarea rows={2} value={f.notes} maxLength={1000} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      <label className="switch">
        <input type="checkbox" checked={f.is_visible} onChange={(e) => set('is_visible', e.target.checked)} />
        <span>إظهار المهمة على شاشة العرض</span>
      </label>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// نسخ جدول يوم آخر
// ---------------------------------------------------------------------
function CopyDayModal({ date, hasTasks, onClose, onDone }: { date: string; hasTasks: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState(addDays(date, -1));
  const [mode, setMode] = useState<'append' | 'replace'>(hasTasks ? 'append' : 'replace');
  const [withDay, setWithDay] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    supabase.from('tasks').select('id', { count: 'exact', head: true }).eq('task_date', from)
      .then(({ count }) => { if (alive) setPreview(count ?? 0); });
    return () => { alive = false; };
  }, [from]);

  async function run() {
    if (from === date) return toast.err('اختر تاريخًا مختلفًا عن التاريخ الحالي');
    setBusy(true);
    const { data, error } = await supabase.rpc('copy_day', { p_from: from, p_to: date, p_mode: mode, p_include_day: withDay });
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    toast.ok(`تم نسخ ${data ?? 0} مهمة`);
    onDone();
  }

  return (
    <Modal title="نسخ جدول من يوم آخر" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>إلغاء</button>
      <button className="btn btn-primary" onClick={run} disabled={busy || !preview}>{busy ? 'جارٍ النسخ…' : 'نسخ'}</button>
    </>}>
      <Field label="انسخ من تاريخ" hint={preview === null ? '' : preview ? `يحتوي ${preview} مهمة` : 'لا توجد مهام في هذا التاريخ'}>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </Field>
      <p className="muted small">إلى: {weekdayName(date)} {gregorianLong(date)} — تُنسخ المهام بحالة «لم تبدأ».</p>
      {hasTasks && (
        <div className="radio-group">
          <label><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> إضافة إلى المهام الحالية</label>
          <label><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> استبدال المهام الحالية (تُحذف)</label>
        </div>
      )}
      <label className="switch"><input type="checkbox" checked={withDay} onChange={(e) => setWithDay(e.target.checked)} /><span>نسخ الأولويات والملاحظات أيضًا</span></label>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// القوالب
// ---------------------------------------------------------------------
function SaveTemplateModal({ date, onClose }: { date: string; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  async function run() {
    const n = name.trim();
    if (!n || n.length > 80) return toast.err('أدخل اسمًا للقالب (حتى 80 حرفًا)');
    setBusy(true);
    const { error } = await supabase.rpc('save_template', { p_name: n, p_date: date });
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    toast.ok('تم حفظ القالب');
    onClose();
  }
  return (
    <Modal title="حفظ جدول اليوم كقالب" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>إلغاء</button>
      <button className="btn btn-primary" onClick={run} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ القالب'}</button>
    </>}>
      <Field label="اسم القالب" hint="إذا وُجد قالب بنفس الاسم فسيتم تحديثه">
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="مثال: يوم عمل اعتيادي" autoFocus />
      </Field>
      <p className="muted small">يُحفظ ترتيب المهام وأوقاتها وأنواعها والأولويات والملاحظات (بدون الحالات).</p>
    </Modal>
  );
}

function ApplyTemplateModal({ date, hasTasks, onClose, onDone }: { date: string; hasTasks: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [list, setList] = useState<Template[] | null>(null);
  const [id, setId] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>(hasTasks ? 'append' : 'replace');
  const [withDay, setWithDay] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('templates').select('*').order('name').then(({ data, error }) => {
      if (error) toast.err(errMsg(error));
      const xs = (data as Template[]) || [];
      setList(xs);
      if (xs[0]) setId(xs[0].id);
    });
  }, [toast]);

  async function run() {
    if (!id) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('apply_template', { p_template: id, p_date: date, p_mode: mode, p_include_day: withDay });
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    toast.ok(`تم تطبيق القالب (${data ?? 0} مهمة)`);
    onDone();
  }

  const selected = list?.find((t) => t.id === id);
  return (
    <Modal title="تطبيق قالب" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>إلغاء</button>
      <button className="btn btn-primary" onClick={run} disabled={busy || !id}>{busy ? 'جارٍ التطبيق…' : 'تطبيق'}</button>
    </>}>
      {!list && <Spinner />}
      {list && !list.length && <Empty>لا توجد قوالب بعد. احفظ جدول أي يوم كقالب أولًا.</Empty>}
      {list && list.length > 0 && (
        <>
          <Field label="القالب">
            <select value={id} onChange={(e) => setId(e.target.value)}>
              {list.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.items.length} مهمة)</option>)}
            </select>
          </Field>
          {selected && (
            <ul className="tpl-items">
              {selected.items.slice(0, 12).map((it, i) => <li key={i}><b>{formatTime(it.start_time)}</b> {it.title}</li>)}
              {selected.items.length > 12 && <li className="muted">+ {selected.items.length - 12} أخرى</li>}
            </ul>
          )}
          {hasTasks && (
            <div className="radio-group">
              <label><input type="radio" checked={mode === 'append'} onChange={() => setMode('append')} /> إضافة إلى المهام الحالية</label>
              <label><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> استبدال المهام الحالية (تُحذف)</label>
            </div>
          )}
          <label className="switch"><input type="checkbox" checked={withDay} onChange={(e) => setWithDay(e.target.checked)} /><span>تطبيق أولويات وملاحظات القالب أيضًا</span></label>
        </>
      )}
    </Modal>
  );
}
