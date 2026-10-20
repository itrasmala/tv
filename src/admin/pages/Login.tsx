import { useState, type FormEvent } from 'react';
import { supabase, errMsg } from '../supabase';

export function Login({ profileError }: { profileError: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setError('أدخل بريدًا إلكترونيًا صحيحًا.'); return; }
    if (!password) { setError('أدخل كلمة المرور.'); return; }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (err) setError(errMsg(err));
  }

  return (
    <div className="login-wrap">
      <form className="login card" onSubmit={submit} noValidate>
        <div className="login-mark" />
        <h1>لوحة إدارة الشاشة</h1>
        <p className="muted">Rasmala Smart Display — سجّل الدخول لإدارة المحتوى</p>
        {(error || profileError) && <div className="note note-err">{error || profileError}</div>}
        {profileError && (
          <button type="button" className="btn btn-block" onClick={() => supabase.auth.signOut()}>تسجيل الخروج من هذا الحساب</button>
        )}
        <label className="field">
          <span className="field-label">البريد الإلكتروني</span>
          <input type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">كلمة المرور</span>
          <input type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'جارٍ الدخول…' : 'تسجيل الدخول'}</button>
        <p className="muted small">نسيت كلمة المرور؟ اطلب من المدير العام إعادة تعيينها.</p>
      </form>
    </div>
  );
}
