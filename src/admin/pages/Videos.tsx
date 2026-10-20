import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_PDF_MB, MAX_PDF_PAGES, pdfToImages } from '../pdf';
import { supabase, errMsg, ensureRows } from '../supabase';
import { useAuth } from '../auth';
import { ScreenPreview } from '../components/Preview';
import { Field, Spinner, useConfirm, useToast } from '../ui';
import { SIDE_LABEL } from '../../shared/labels';
import type { ScreenSettings, ScreenVideoRow, Side, SideMode, VideoConfig, VideoFit } from '../../shared/types';

const MAX_VIDEO_MB = 50; // حد رفع الملف في خطة Supabase المجانية
const MAX_IMAGE_MB = 5;
const SIDES: Side[] = ['right', 'left'];

interface StoredFile { name: string; path: string; size: number; url: string; }

export function Videos() {
  const { canVideos } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<Record<Side, ScreenVideoRow> | null>(null);
  const [draft, setDraft] = useState<Record<Side, VideoConfig> | null>(null);
  const [split, setSplit] = useState<Pick<ScreenSettings, 'split_right' | 'split_left'>>({ split_right: 25, split_left: 25 });
  const [showPreview, setShowPreview] = useState(false);
  const [libKey, setLibKey] = useState(0);

  const load = useCallback(async () => {
    const [v, s] = await Promise.all([
      supabase.from('screen_videos').select('*'),
      supabase.from('screen_settings').select('split_right, split_left').eq('id', 1).maybeSingle(),
    ]);
    if (v.error) return toast.err(errMsg(v.error));
    const map = {} as Record<Side, ScreenVideoRow>;
    for (const side of SIDES) {
      const r = (v.data as ScreenVideoRow[]).find((x) => x.side === side);
      map[side] = r || { side, url: null, fit: 'cover', poster_url: null, enabled: true, mode: 'video', slide_urls: [], slide_seconds: 8 };
    }
    setRows(map);
    setDraft({ right: pick(map.right), left: pick(map.left) });
    if (s.data) setSplit(s.data as typeof split);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  if (!rows || !draft) return <div className="page"><Spinner label="جارٍ تحميل إعدادات الفيديو…" /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>فيديوهات الجانبين</h1>
          <p className="muted">الفيديو يعمل تلقائيًا، مكتوم الصوت، ومتكرر. لا يُعاد تحميله عند تعديل المهام.</p>
        </div>
        <button className="btn" onClick={() => setShowPreview((x) => !x)}>{showPreview ? 'إخفاء المعاينة' : 'معاينة الشاشة'}</button>
      </div>

      {!canVideos && <div className="note note-info">لا تملك صلاحية تعديل الفيديوهات — يمكنك الاطلاع فقط. يمنح المدير العام هذه الصلاحية من صفحة المستخدمين.</div>}

      {showPreview && (
        <div className="card">
          <h2>معاينة (تشمل التعديلات غير المحفوظة)</h2>
          <ScreenPreview videos={draft} />
        </div>
      )}

      <div className="note note-tip">
        <b>لأداء سلس على التلفزيون:</b> استخدم MP4 بترميز H.264، بدقة تطابق مقاس القسم (الأيمن الآن {Math.round(19.2 * split.split_right)}×1080 والأيسر {Math.round(19.2 * split.split_left)}×1080 تقريبًا)،
        30 إطارًا/ثانية، ومعدل بت 2–4 Mbps، وبدون صوت. فيديو 4K أو أفقي كبير داخل قسم ضيق يستهلك معالج الشاشة دون فائدة. التفاصيل وأوامر التحويل في دليل README.
      </div>

      <div className="grid-2">
        {SIDES.map((side) => (
          <SideEditor
            key={side}
            side={side}
            saved={rows[side]}
            value={draft[side]}
            hidden={(side === 'right' ? split.split_right : split.split_left) === 0}
            paneWidth={Math.round(19.2 * (side === 'right' ? split.split_right : split.split_left)) || 480}
            canEdit={canVideos}
            onChange={(v) => setDraft((d) => (d ? { ...d, [side]: v } : d))}
            onSaved={(r) => { setRows((x) => (x ? { ...x, [side]: r } : x)); setLibKey((k) => k + 1); }}
            onUploaded={() => setLibKey((k) => k + 1)}
          />
        ))}
      </div>

      <MediaLibrary key={libKey} canEdit={canVideos} inUse={[
        rows.right.url, rows.left.url, rows.right.poster_url, rows.left.poster_url,
        draft.right.url, draft.left.url, draft.right.poster_url, draft.left.poster_url,
        ...(rows.right.slide_urls || []), ...(rows.left.slide_urls || []),
        ...(draft.right.slide_urls || []), ...(draft.left.slide_urls || []),
      ]} />
    </div>
  );
}

const pick = (r: ScreenVideoRow): VideoConfig => ({
  url: r.url, fit: r.fit, poster_url: r.poster_url, enabled: r.enabled,
  mode: r.mode === 'slides' ? 'slides' : 'video', slide_urls: r.slide_urls || [], slide_seconds: r.slide_seconds || 8,
});

async function uploadBlob(path: string, blob: Blob, contentType: string): Promise<string> {
  const { error } = await supabase.storage.from('media').upload(path, blob, { cacheControl: '31536000', contentType, upsert: false });
  if (error) throw error;
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}

async function uploadFile(folder: 'videos' | 'posters', file: File, side: Side): Promise<string> {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = `${folder}/${side}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('media').upload(path, file, {
    cacheControl: '31536000', // اسم الملف فريد، لذا يمكن للشاشة تخزينه مؤقتًا لمدة طويلة = استهلاك أقل
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return supabase.storage.from('media').getPublicUrl(path).data.publicUrl;
}

function SideEditor({ side, saved, value, hidden, paneWidth, canEdit, onChange, onSaved, onUploaded }: {
  side: Side; saved: ScreenVideoRow; value: VideoConfig; hidden: boolean; paneWidth: number; canEdit: boolean;
  onChange: (v: VideoConfig) => void; onSaved: (r: ScreenVideoRow) => void; onUploaded: () => void;
}) {
  const toast = useToast();
  const [urlInput, setUrlInput] = useState(value.url || '');
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [playErr, setPlayErr] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const imgsRef = useRef<HTMLInputElement>(null);

  const mode: SideMode = value.mode === 'slides' ? 'slides' : 'video';
  const slides = value.slide_urls || [];
  const dirty = useMemo(() => JSON.stringify(pick(saved)) !== JSON.stringify(value), [saved, value]);
  const set = (patch: Partial<VideoConfig>) => onChange({ ...value, ...patch });

  // معاينة صغيرة تتنقل بين الشرائح
  useEffect(() => {
    setPreviewIdx(0);
    if (mode !== 'slides' || slides.length < 2) return;
    const t = setInterval(() => setPreviewIdx((i) => (i + 1) % slides.length), 2500);
    return () => clearInterval(t);
  }, [mode, slides.length, slides[0]]);

  function applyUrl() {
    const u = urlInput.trim();
    if (!u) { set({ url: null }); return; }
    if (!/^https:\/\/\S+$/i.test(u)) return toast.err('الرابط يجب أن يبدأ بـ https:// (الروابط غير الآمنة لا تعمل داخل صفحة آمنة)');
    if (/youtube\.com|youtu\.be|vimeo\.com|drive\.google\.com\/file/i.test(u)) {
      toast.info('روابط YouTube/Vimeo/Google Drive ليست روابط MP4 مباشرة وقد لا تعمل. استخدم رابطًا ينتهي بملف .mp4 أو ارفع الملف.');
    }
    setPlayErr(false);
    set({ url: u });
  }

  async function onPickVideo(f: File | undefined) {
    if (!f) return;
    if (f.type !== 'video/mp4') return toast.err('الملف يجب أن يكون بصيغة MP4');
    if (f.size > MAX_VIDEO_MB * 1024 * 1024) return toast.err(`حجم الملف ${(f.size / 1048576).toFixed(1)}MB — الحد الأقصى ${MAX_VIDEO_MB}MB. اضغط الفيديو أولًا (انظر الدليل).`);
    setUploading('video');
    try {
      const url = await uploadFile('videos', f, side);
      setUrlInput(url);
      setPlayErr(false);
      set({ url });
      toast.ok('تم رفع الفيديو — اضغط «حفظ ونشر» لعرضه على الشاشة');
      onUploaded();
    } catch (e) { toast.err(errMsg(e)); }
    finally { setUploading(null); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function onPickPoster(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast.err('الصورة يجب أن تكون PNG أو JPG أو WEBP');
    if (f.size > MAX_IMAGE_MB * 1024 * 1024) return toast.err(`الحد الأقصى للصورة ${MAX_IMAGE_MB}MB`);
    setUploading('poster');
    try {
      const url = await uploadFile('posters', f, side);
      set({ poster_url: url });
      toast.ok('تم رفع الصورة الاحتياطية');
      onUploaded();
    } catch (e) { toast.err(errMsg(e)); }
    finally { setUploading(null); if (posterRef.current) posterRef.current.value = ''; }
  }

  // ---------- PDF ← صور ----------
  async function onPickPdf(f: File | undefined) {
    if (!f) return;
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return toast.err('اختر ملف PDF');
    if (f.size > MAX_PDF_MB * 1024 * 1024) return toast.err(`الحد الأقصى لملف PDF هو ${MAX_PDF_MB}MB`);
    setUploading('تجهيز الملف…');
    try {
      // دقة الصور تكفي القسم حتى 40% من الشاشة مع وضوح النص
      const { blobs, totalPages } = await pdfToImages(f, {
        maxWidth: 800, maxHeight: 1600,
        onProgress: ({ done, total }) => setUploading(`تحويل الصفحة ${Math.min(done + 1, total)} من ${total}…`),
      });
      const stamp = Date.now();
      const urls: string[] = [];
      for (let i = 0; i < blobs.length; i++) {
        setUploading(`رفع الصفحة ${i + 1} من ${blobs.length}…`);
        urls.push(await uploadBlob(`slides/${side}-${stamp}-${String(i + 1).padStart(2, '0')}.jpg`, blobs[i], 'image/jpeg'));
      }
      set({ mode: 'slides', slide_urls: urls, fit: 'contain' });
      onUploaded();
      toast.ok(`تم تحويل ${urls.length} صفحة — اضغط «حفظ ونشر»` + (totalPages > urls.length ? ` (الحد ${MAX_PDF_PAGES} صفحة)` : ''));
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      toast.err(/password/i.test(m) ? 'الملف محمي بكلمة مرور — احفظه بدون حماية ثم أعد المحاولة' : /Invalid PDF|corrupt/i.test(m) ? 'ملف PDF تالف أو غير صالح' : errMsg(e));
    } finally { setUploading(null); if (pdfRef.current) pdfRef.current.value = ''; }
  }

  async function onPickImages(files: FileList | null) {
    if (!files || !files.length) return;
    const list = Array.from(files);
    if (list.some((f) => !/^image\/(png|jpeg|webp)$/.test(f.type))) return toast.err('الصور يجب أن تكون PNG أو JPG أو WEBP');
    if (list.some((f) => f.size > MAX_IMAGE_MB * 1024 * 1024)) return toast.err(`الحد الأقصى لكل صورة ${MAX_IMAGE_MB}MB`);
    if (slides.length + list.length > MAX_PDF_PAGES) return toast.err(`الحد الأقصى ${MAX_PDF_PAGES} شريحة`);
    const stamp = Date.now();
    const urls: string[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        setUploading(`رفع الصورة ${i + 1} من ${list.length}…`);
        const ext = list[i].type.split('/')[1].replace('jpeg', 'jpg');
        urls.push(await uploadBlob(`slides/${side}-${stamp}-img${i + 1}.${ext}`, list[i], list[i].type));
      }
      set({ mode: 'slides', slide_urls: [...slides, ...urls] });
      onUploaded();
      toast.ok(`تمت إضافة ${urls.length} صورة — اضغط «حفظ ونشر»`);
    } catch (e) { toast.err(errMsg(e)); }
    finally { setUploading(null); if (imgsRef.current) imgsRef.current.value = ''; }
  }

  function moveSlide(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= slides.length) return;
    const next = slides.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set({ slide_urls: next });
  }

  async function save() {
    if (mode === 'slides' && !slides.length) return toast.err('أضف ملف PDF أو صورًا أولًا');
    setSaving(true);
    const { data, error } = await supabase.from('screen_videos').update(value).eq('side', side).select();
    setSaving(false);
    if (error) return toast.err(errMsg(error));
    try { const rows = ensureRows(data); onSaved(rows[0] as ScreenVideoRow); } catch (e) { return toast.err(errMsg(e)); }
    toast.ok(`تم النشر على ${SIDE_LABEL[side]}`);
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>{SIDE_LABEL[side]}</h2>
        {canEdit && <button className="btn btn-primary" onClick={save} disabled={!dirty || saving || !!uploading}>{saving ? 'جارٍ الحفظ…' : dirty ? 'حفظ ونشر' : 'محفوظ'}</button>}
      </div>
      {hidden && <div className="note note-info">عرض هذا القسم حاليًا 0% في إعدادات الشاشة، لذلك لن يظهر محتواه ولن يُحمّل.</div>}

      <div className="seg" role="tablist" aria-label="نوع المحتوى">
        <button role="tab" className={mode === 'video' ? 'on' : ''} disabled={!canEdit} onClick={() => set({ mode: 'video' })}>فيديو</button>
        <button role="tab" className={mode === 'slides' ? 'on' : ''} disabled={!canEdit} onClick={() => set({ mode: 'slides', fit: 'contain' })}>عرض شرائح (PDF / صور)</button>
      </div>

      {mode === 'slides' ? (
        <>
          <div className={'vid-preview' + (value.fit === 'contain' ? ' contain' : '')}>
            {slides.length ? <img src={slides[Math.min(previewIdx, slides.length - 1)]} alt="" /> : <div className="vid-empty">لا توجد شرائح بعد</div>}
          </div>
          <div className="note note-tip small">
            الأخف على التلفزيون: لا يوجد فك ترميز فيديو إطلاقًا. أفضل مقاس لصفحات الـ PDF: طولي بنسبة القسم ({paneWidth}×1080). يُحوَّل الملف إلى صور داخل متصفحك ثم تُرفع الصور فقط.
          </div>
          {canEdit && (
            <div className="row-actions">
              <input ref={pdfRef} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => onPickPdf(e.target.files?.[0])} />
              <input ref={imgsRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => onPickImages(e.target.files)} />
              <button className="btn btn-primary" onClick={() => pdfRef.current?.click()} disabled={!!uploading}>{uploading || `رفع ملف PDF (حتى ${MAX_PDF_PAGES} صفحة)`}</button>
              <button className="btn" onClick={() => imgsRef.current?.click()} disabled={!!uploading}>إضافة صور</button>
              {slides.length > 0 && <button className="btn btn-ghost danger" onClick={() => set({ slide_urls: [] })} disabled={!!uploading}>إزالة كل الشرائح</button>}
            </div>
          )}
          {slides.length > 0 && (
            <div className="slide-grid">
              {slides.map((u, i) => (
                <div key={u + i} className={'slide-thumb' + (i === previewIdx ? ' on' : '')}>
                  <img src={u} alt={`شريحة ${i + 1}`} loading="lazy" onClick={() => setPreviewIdx(i)} />
                  <span className="slide-n">{i + 1}</span>
                  {canEdit && (
                    <div className="slide-act">
                      <button className="icon-btn" onClick={() => moveSlide(i, -1)} disabled={i === 0} aria-label="تقديم">→</button>
                      <button className="icon-btn danger" onClick={() => set({ slide_urls: slides.filter((_, j) => j !== i) })} aria-label="حذف">✕</button>
                      <button className="icon-btn" onClick={() => moveSlide(i, 1)} disabled={i === slides.length - 1} aria-label="تأخير">←</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="form-grid">
            <Field label="مدة عرض كل شريحة">
              <select value={value.slide_seconds || 8} disabled={!canEdit} onChange={(e) => set({ slide_seconds: Number(e.target.value) })}>
                {[5, 8, 10, 12, 15, 20, 30, 45, 60].map((s) => <option key={s} value={s}>{s} ثانية</option>)}
              </select>
            </Field>
            <Field label="طريقة العرض">
              <select value={value.fit} disabled={!canEdit} onChange={(e) => set({ fit: e.target.value as VideoFit })}>
                <option value="contain">إظهار الصفحة كاملة (موصى به)</option>
                <option value="cover">ملء القسم (قد يقص الأطراف)</option>
              </select>
            </Field>
          </div>
        </>
      ) : (
        <>
          <div className={'vid-preview' + (value.fit === 'contain' ? ' contain' : '')}>
            {value.url ? (
              <video key={value.url} src={value.url} poster={value.poster_url || undefined} muted loop autoPlay playsInline controls
                onError={() => setPlayErr(true)} onPlaying={() => setPlayErr(false)} />
            ) : value.poster_url ? <img src={value.poster_url} alt="" /> : <div className="vid-empty">لا يوجد فيديو</div>}
          </div>
          {playErr && <div className="note note-err">تعذّر تشغيل هذا الرابط. تأكد أنه رابط مباشر لملف MP4 (H.264) ومتاح للعامة. ستعرض الشاشة الصورة الاحتياطية أو اسم المؤسسة بدلًا منه.</div>}

          <Field label="رابط مباشر لملف MP4" hint="ارفع ملفًا أو الصق رابطًا مباشرًا يبدأ بـ https://">
            <div className="input-row">
              <input dir="ltr" value={urlInput} disabled={!canEdit} onChange={(e) => setUrlInput(e.target.value)} onBlur={applyUrl} placeholder="https://…/video.mp4" />
              {canEdit && <button className="btn" onClick={applyUrl}>تطبيق</button>}
            </div>
          </Field>

          {canEdit && (
            <div className="row-actions">
              <input ref={fileRef} type="file" accept="video/mp4" hidden onChange={(e) => onPickVideo(e.target.files?.[0])} />
              <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!uploading}>
                {uploading === 'video' ? 'جارٍ الرفع… (قد يستغرق دقيقة)' : `رفع فيديو MP4 (حتى ${MAX_VIDEO_MB}MB)`}
              </button>
              {value.url && <button className="btn btn-ghost danger" onClick={() => { setUrlInput(''); set({ url: null }); }}>إزالة الفيديو</button>}
            </div>
          )}

          <Field label="طريقة العرض">
            <select value={value.fit} disabled={!canEdit} onChange={(e) => set({ fit: e.target.value as VideoFit })}>
              <option value="cover">ملء القسم (قص الأطراف دون تشويه)</option>
              <option value="contain">إظهار الفيديو كاملًا (مع هوامش)</option>
            </select>
          </Field>
        </>
      )}

      <Field label="الحالة">
        <label className="switch inline">
          <input type="checkbox" checked={value.enabled} disabled={!canEdit} onChange={(e) => set({ enabled: e.target.checked })} />
          <span>{value.enabled ? 'مفعّل' : 'متوقف (تظهر الصورة الاحتياطية)'}</span>
        </label>
      </Field>

      <Field label="صورة احتياطية (تظهر إذا تعذّر تحميل المحتوى)">
        <div className="row-actions">
          {value.poster_url ? <img className="poster-thumb" src={value.poster_url} alt="" /> : <span className="muted small">لا توجد — سيظهر اسم المؤسسة</span>}
          {canEdit && <>
            <input ref={posterRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onPickPoster(e.target.files?.[0])} />
            <button className="btn btn-sm" onClick={() => posterRef.current?.click()} disabled={!!uploading}>{uploading === 'poster' ? 'جارٍ الرفع…' : 'رفع صورة'}</button>
            {value.poster_url && <button className="btn btn-sm btn-ghost danger" onClick={() => set({ poster_url: null })}>إزالة</button>}
          </>}
        </div>
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------
// مكتبة الملفات المرفوعة (لإدارة مساحة التخزين المجانية 1GB)
// ---------------------------------------------------------------------
function MediaLibrary({ canEdit, inUse }: { canEdit: boolean; inUse: (string | null)[] }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [files, setFiles] = useState<StoredFile[] | null>(null);

  const load = useCallback(async () => {
    const out: StoredFile[] = [];
    for (const folder of ['videos', 'slides', 'posters']) {
      const { data, error } = await supabase.storage.from('media').list(folder, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } });
      if (error) { toast.err(errMsg(error)); continue; }
      for (const f of data || []) {
        if (!f.id) continue;
        const path = `${folder}/${f.name}`;
        out.push({ name: f.name, path, size: (f.metadata as { size?: number } | null)?.size || 0, url: supabase.storage.from('media').getPublicUrl(path).data.publicUrl });
      }
    }
    setFiles(out);
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  async function remove(f: StoredFile) {
    if (!(await confirm({ title: 'حذف ملف', text: `حذف «${f.name}» نهائيًا من التخزين؟`, confirmText: 'حذف', danger: true }))) return;
    const { data, error } = await supabase.storage.from('media').remove([f.path]);
    if (error) return toast.err(errMsg(error));
    if (!data?.length) return toast.err('لم يتم الحذف — تحقق من صلاحياتك.');
    toast.ok('تم حذف الملف');
    load();
  }

  const unused = (files || []).filter((f) => !inUse.includes(f.url));
  async function removeUnused() {
    if (!unused.length) return;
    if (!(await confirm({ title: 'تنظيف الملفات', text: `حذف ${unused.length} ملف غير مستخدم نهائيًا من التخزين؟ (احفظ تعديلاتك أولًا)`, confirmText: 'حذف', danger: true }))) return;
    const { data, error } = await supabase.storage.from('media').remove(unused.map((f) => f.path));
    if (error) return toast.err(errMsg(error));
    toast.ok(`تم حذف ${data?.length || 0} ملف`);
    load();
  }

  const total = (files || []).reduce((s, f) => s + f.size, 0);
  return (
    <div className="card">
      <div className="card-head">
        <h2>الملفات المرفوعة <span className="muted small">({(total / 1048576).toFixed(1)}MB من مساحة 1GB المجانية)</span></h2>
        {canEdit && unused.length > 0 && <button className="btn btn-sm btn-ghost danger" onClick={removeUnused}>حذف كل غير المستخدم ({unused.length})</button>}
      </div>
      {!files && <Spinner />}
      {files && !files.length && <p className="muted">لا توجد ملفات مرفوعة.</p>}
      {files && files.length > 0 && (
        <table className="tbl">
          <thead><tr><th>الملف</th><th>الحجم</th><th>الحالة</th><th /></tr></thead>
          <tbody>
            {files.map((f) => {
              const used = inUse.includes(f.url);
              return (
                <tr key={f.path}>
                  <td dir="ltr" className="mono">{f.path}</td>
                  <td>{(f.size / 1048576).toFixed(1)}MB</td>
                  <td>{used ? <span className="badge badge-ok">مستخدم</span> : <span className="badge">غير مستخدم</span>}</td>
                  <td>{canEdit && !used && <button className="btn btn-sm btn-ghost danger" onClick={() => remove(f)}>حذف</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
