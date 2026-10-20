import { useState } from 'react';
import { supabase, errMsg } from '../supabase';
import { useAuth } from '../auth';
import { Field, useToast } from '../ui';
import { ROLE_LABEL } from '../../shared/labels';

export function Account() {
  const { profile, signOut } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);

  async function change() {
    if (pw.length < 8) return toast.err('كلمة المرور يجب ألا تقل عن 8 أحرف');
    if (!/[A-Za-z؀-ۿ]/.test(pw) || !/\d/.test(pw)) return toast.err('استخدم حروفًا وأرقامًا معًا');
    if (pw !== pw2) return toast.err('كلمتا المرور غير متطابقتين');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) {
      if (/reauthenticat|nonce/i.test(error.message)) return toast.err('تتطلب إعدادات الأمان إعادة المصادقة. سجّل الخروج ثم الدخول وأعد المحاولة خلال دقائق.');
      if (/same|different from the old/i.test(error.message)) return toast.err('كلمة المرور الجديدة يجب أن تختلف عن الحالية');
      return toast.err(errMsg(error));
    }
    setPw(''); setPw2('');
    toast.ok('تم تغيير كلمة المرور');
  }

  return (
    <div className="page">
      <div className="page-head"><h1>حسابي</h1></div>
      <div className="grid-2">
        <div className="card">
          <h2>بيانات الحساب</h2>
          <dl className="dl">
            <dt>الاسم</dt><dd>{profile?.full_name || '—'}</dd>
            <dt>البريد</dt><dd dir="ltr">{profile?.email}</dd>
            <dt>الصلاحية</dt><dd>{profile && ROLE_LABEL[profile.role]}{profile?.role === 'editor' && profile.can_manage_videos ? ' + الفيديوهات' : ''}</dd>
          </dl>
          <button className="btn" onClick={() => signOut()}>تسجيل الخروج</button>
        </div>
        <div className="card">
          <h2>تغيير كلمة المرور</h2>
          <Field label="كلمة المرور الجديدة" hint="8 أحرف على الأقل، حروف وأرقام">
            <input type="password" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </Field>
          <Field label="تأكيد كلمة المرور">
            <input type="password" dir="ltr" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </Field>
          <button className="btn btn-primary" onClick={change} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'تغيير كلمة المرور'}</button>
        </div>
      </div>
    </div>
  );
}
