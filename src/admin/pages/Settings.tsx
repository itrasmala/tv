import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, errMsg, ensureRows } from '../supabase';
import { useAuth } from '../auth';
import { ScreenPreview } from '../components/Preview';
import { Field, Spinner, useToast } from '../ui';
import { DEFAULT_SETTINGS } from '../../shared/labels';
import type { ScreenSettings } from '../../shared/types';

type Editable = Omit<ScreenSettings, 'updated_at'>;
const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Editable)[];
const PRESETS: [number, number, number][] = [[25, 50, 25], [20, 60, 20], [30, 40, 30], [0, 100, 0], [0, 70, 30], [30, 70, 0]];
const HEX = /^#[0-9A-Fa-f]{6}$/;

export function Settings() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [saved, setSaved] = useState<Editable | null>(null);
  const [f, setF] = useState<Editable | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const logoRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('screen_settings').select('*').eq('id', 1).maybeSingle();
    if (error) return toast.err(errMsg(error));
    const row = { ...DEFAULT_SETTINGS, ...(data || {}) } as Editable;
    const clean = Object.fromEntries(KEYS.map((k) => [k, row[k]])) as unknown as Editable;
    setSaved(clean);
    setF(clean);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => JSON.stringify(f) !== JSON.stringify(saved), [f, saved]);
  if (!f || !saved) return <div className="page"><Spinner label="جارٍ تحميل الإعدادات…" /></div>;

  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setF((x) => (x ? { ...x, [k]: v } : x));
  const ro = !isAdmin;

  function setSide(side: 'split_right' | 'split_left', v: number) {
    if (!f) return;
    const val = Math.max(0, Math.min(40, Math.round(v || 0)));
    const other = side === 'split_right' ? f.split_left : f.split_right;
    const center = 100 - val - other;
    setF({ ...f, [side]: val, split_center: center });
  }

  const splitErr =
    f.split_right + f.split_center + f.split_left !== 100 ? 'المجموع يجب أن يساوي 100%'
      : f.split_center < 30 ? 'القسم الأوسط يجب ألا يقل عن 30%' : '';

  async function onLogo(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.err('الشعار يجب أن يكون PNG أو JPG أو WEBP');
    if (file.size > 2 * 1024 * 1024) return toast.err('الحد الأقصى لحجم الشعار 2MB');
    setUploading(true);
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `logos/logo-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('media').upload(path, file, { cacheControl: '31536000', contentType: file.type });
      if (error) throw error;
      set('logo_url', supabase.storage.from('media').getPublicUrl(path).data.publicUrl);
      toast.ok('تم رفع الشعار — اضغط «حفظ ونشر»');
    } catch (e) { toast.err(errMsg(e)); }
    finally { setUploading(false); if (logoRef.current) logoRef.current.value = ''; }
  }

  async function save() {
    if (!f) return;
    if (splitErr) return toast.err(splitErr);
    if (!f.org_name.trim() || !f.screen_title.trim()) return toast.err('اسم المؤسسة وعنوان الشاشة مطلوبان');
    const colors = [f.color_primary, f.color_accent, f.color_bg, f.color_prayer, f.color_break];
    if (colors.some((c) => !HEX.test(c))) return toast.err('أحد الألوان غير صالح');
    if (f.logo_url && !/^https:\/\//.test(f.logo_url)) return toast.err('رابط الشعار يجب أن يبدأ بـ https://');
    setSaving(true);
    const { data, error } = await supabase.from('screen_settings')
      .update({ ...f, org_name: f.org_name.trim(), screen_title: f.screen_title.trim() }).eq('id', 1).select();
    setSaving(false);
    if (error) return toast.err(errMsg(error));
    try { ensureRows(data); } catch (e) { return toast.err(errMsg(e)); }
    setSaved(f);
    toast.ok('تم حفظ الإعدادات ونشرها على الشاشة');
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>إعدادات الشاشة</h1>
          <p className="muted">التقسيم والألوان والشعار وسلوك العرض. المعاينة أدناه تتحدث فورًا قبل النشر.</p>
        </div>
        {isAdmin && (
          <div className="row-actions">
            <button className="btn" onClick={() => setF(saved)} disabled={!dirty}>تراجع</button>
            <button className="btn btn-primary" onClick={save} disabled={!dirty || saving || !!splitErr}>{saving ? 'جارٍ النشر…' : 'حفظ ونشر'}</button>
          </div>
        )}
      </div>
      {ro && <div className="note note-info">تعديل إعدادات الشاشة متاح للمدير العام فقط.</div>}

      <div className="card sticky-preview">
        <h2>معاينة قبل النشر {dirty && <span className="badge badge-gold">تعديلات غير منشورة</span>}</h2>
        <ScreenPreview settings={f} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>الهوية</h2>
          <Field label="اسم المؤسسة"><input value={f.org_name} maxLength={80} disabled={ro} onChange={(e) => set('org_name', e.target.value)} /></Field>
          <Field label="عنوان الشاشة"><input value={f.screen_title} maxLength={80} disabled={ro} onChange={(e) => set('screen_title', e.target.value)} /></Field>
          <Field label="الشعار" hint="PNG بخلفية شفافة يظهر أفضل. يُعرض بجانب العنوان.">
            <div className="row-actions">
              {f.logo_url ? <img className="logo-thumb" src={f.logo_url} alt="الشعار" /> : <span className="muted small">لا يوجد شعار</span>}
              {!ro && <>
                <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
                <button className="btn btn-sm" onClick={() => logoRef.current?.click()} disabled={uploading}>{uploading ? 'جارٍ الرفع…' : 'رفع شعار'}</button>
                {f.logo_url && <button className="btn btn-sm btn-ghost danger" onClick={() => set('logo_url', null)}>إزالة</button>}
              </>}
            </div>
          </Field>
        </div>

        <div className="card">
          <h2>تقسيم الشاشة</h2>
          <div className="split-bar" aria-hidden>
            {f.split_right > 0 && <span className="sb-video" style={{ width: f.split_right + '%' }}>{f.split_right}%</span>}
            <span className="sb-center" style={{ width: f.split_center + '%' }}>{f.split_center}%</span>
            {f.split_left > 0 && <span className="sb-video" style={{ width: f.split_left + '%' }}>{f.split_left}%</span>}
          </div>
          <div className="form-grid three">
            <Field label="الأيمن (فيديو)"><input type="number" min={0} max={40} value={f.split_right} disabled={ro} onChange={(e) => setSide('split_right', Number(e.target.value))} /></Field>
            <Field label="الأوسط (الجدول)"><input type="number" value={f.split_center} disabled readOnly /></Field>
            <Field label="الأيسر (فيديو)"><input type="number" min={0} max={40} value={f.split_left} disabled={ro} onChange={(e) => setSide('split_left', Number(e.target.value))} /></Field>
          </div>
          {splitErr && <div className="field-error">{splitErr}</div>}
          {!ro && (
            <div className="row-actions">
              {PRESETS.map(([r, c, l]) => (
                <button key={`${r}-${c}-${l}`} className="btn btn-sm" onClick={() => setF({ ...f, split_right: r, split_center: c, split_left: l })}>{r}/{c}/{l}</button>
              ))}
            </div>
          )}
          <p className="muted small">القسم الأوسط يُحسب تلقائيًا. وضع 0% لأي جانب يخفيه ويوقف تحميل الفيديو فيه (أخف على الشاشة).</p>
        </div>

        <div className="card">
          <h2>الألوان</h2>
          <div className="colors">
            {([
              ['color_primary', 'الكحلي (الأساسي)'],
              ['color_accent', 'الذهبي (التمييز)'],
              ['color_bg', 'الخلفية العاجية'],
              ['color_prayer', 'خلفية فترات الصلاة'],
              ['color_break', 'خلفية الاستراحة'],
            ] as [keyof Editable, string][]).map(([k, label]) => (
              <label key={k} className="color-field">
                <input type="color" value={String(f[k])} disabled={ro} onChange={(e) => set(k, e.target.value.toUpperCase() as never)} />
                <span>{label}</span>
                <code dir="ltr">{String(f[k])}</code>
              </label>
            ))}
          </div>
          {!ro && <button className="btn btn-sm btn-ghost" onClick={() => setF({ ...f, color_primary: DEFAULT_SETTINGS.color_primary, color_accent: DEFAULT_SETTINGS.color_accent, color_bg: DEFAULT_SETTINGS.color_bg, color_prayer: DEFAULT_SETTINGS.color_prayer, color_break: DEFAULT_SETTINGS.color_break })}>استعادة الألوان الافتراضية</button>}
        </div>

        <div className="card">
          <h2>سلوك العرض</h2>
          <div className="form-grid">
            <Field label="مدة عرض كل صفحة من المهام" hint="عند زيادة المهام عن مساحة الشاشة تُعرض على صفحات تتبدل تلقائيًا">
              <select value={f.page_seconds} disabled={ro} onChange={(e) => set('page_seconds', Number(e.target.value))}>
                {[8, 10, 12, 15, 20, 30, 45, 60].map((s) => <option key={s} value={s}>{s} ثانية</option>)}
              </select>
            </Field>
            <Field label="إعادة تحميل يومية للشاشة" hint="تنظّف الذاكرة وتستلم آخر تحديث للتطبيق — يُفضّل خارج الدوام">
              <select value={f.reload_hour ?? ''} disabled={ro} onChange={(e) => set('reload_hour', e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">معطلة</option>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>الساعة {h}:00</option>)}
              </select>
            </Field>
            <Field label="صيغة الوقت">
              <select value={f.time_format} disabled={ro} onChange={(e) => set('time_format', e.target.value as '12' | '24')}>
                <option value="12">12 ساعة (ص / م)</option>
                <option value="24">24 ساعة</option>
              </select>
            </Field>
            <Field label="الأرقام">
              <select value={f.numerals} disabled={ro} onChange={(e) => set('numerals', e.target.value as 'latn' | 'arab')}>
                <option value="latn">0123456789</option>
                <option value="arab">٠١٢٣٤٥٦٧٨٩</option>
              </select>
            </Field>
          </div>
          <label className="switch"><input type="checkbox" checked={f.show_hijri} disabled={ro} onChange={(e) => set('show_hijri', e.target.checked)} /><span>إظهار التاريخ الهجري</span></label>
          <label className="switch"><input type="checkbox" checked={f.show_assignee} disabled={ro} onChange={(e) => set('show_assignee', e.target.checked)} /><span>إظهار اسم المسؤول عن المهمة</span></label>
        </div>
      </div>
    </div>
  );
}
