import { useCallback, useEffect, useState } from 'react';
import { adminUsers, errMsg } from '../supabase';
import { useAuth } from '../auth';
import { Field, Modal, Spinner, useConfirm, useToast } from '../ui';
import { ROLE_LABEL } from '../../shared/labels';
import { formatStamp } from '../../shared/time';
import type { Profile, Role } from '../../shared/types';

const ROLES: Role[] = ['admin', 'editor', 'viewer'];

export function Users() {
  const { profile: me } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Profile | 'new' | null>(null);
  const [resetting, setResetting] = useState<Profile | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminUsers<{ users: Profile[] }>({ action: 'list' });
      setUsers(res.users);
      setError(null);
    } catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function toggleActive(u: Profile) {
    const disabling = u.is_active;
    if (disabling && !(await confirm({ title: 'تعطيل حساب', text: `تعطيل حساب ${u.email}؟ سيُمنع من الدخول فورًا ويمكن إعادة تفعيله لاحقًا.`, confirmText: 'تعطيل', danger: true }))) return;
    try {
      await adminUsers({ action: 'update', id: u.id, is_active: !u.is_active });
      toast.ok(disabling ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب');
      load();
    } catch (e) { toast.err(errMsg(e)); }
  }

  async function remove(u: Profile) {
    if (!(await confirm({ title: 'حذف مستخدم', text: `حذف حساب ${u.email} نهائيًا؟ لا يمكن التراجع. (يبقى سجل تعديلاته في سجل التدقيق)`, confirmText: 'حذف نهائي', danger: true }))) return;
    try {
      await adminUsers({ action: 'delete', id: u.id });
      toast.ok('تم حذف المستخدم');
      load();
    } catch (e) { toast.err(errMsg(e)); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>المستخدمون والصلاحيات</h1>
          <p className="muted">الصلاحيات مفروضة في قاعدة البيانات نفسها، وليست مجرد إخفاء أزرار.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ إضافة مستخدم</button>
      </div>

      <div className="card roles-help">
        <div><b>مدير عام:</b> كل الصلاحيات، بما فيها المستخدمون والإعدادات وسجل التدقيق.</div>
        <div><b>محرر محتوى:</b> المهام والأولويات والملاحظات والقوالب، والفيديوهات إن مُنح صلاحيتها.</div>
        <div><b>مشاهد فقط:</b> يطّلع على لوحة الإدارة دون أي تعديل.</div>
      </div>

      {error && <div className="note note-err">{error}</div>}
      {!users && !error && <Spinner label="جارٍ تحميل المستخدمين…" />}
      {users && (
        <div className="card table-wrap">
          <table className="tbl">
            <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الفيديو</th><th>الحالة</th><th>آخر دخول</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={u.is_active ? '' : 'row-muted'}>
                  <td>{u.full_name || '—'}{u.id === me?.id && <span className="badge"> أنت</span>}</td>
                  <td dir="ltr" className="mono">{u.email}</td>
                  <td><span className={`badge role-${u.role}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td>{u.role === 'admin' || (u.role === 'editor' && u.can_manage_videos) ? '✓' : '—'}</td>
                  <td>{u.is_active ? <span className="badge badge-ok">نشط</span> : <span className="badge badge-err">معطّل</span>}</td>
                  <td className="small">{u.last_sign_in_at ? formatStamp(u.last_sign_in_at) : 'لم يدخل بعد'}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => setEditing(u)}>تعديل</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setResetting(u)}>كلمة المرور</button>
                    {u.id !== me?.id && <>
                      <button className="btn btn-sm btn-ghost" onClick={() => toggleActive(u)}>{u.is_active ? 'تعطيل' : 'تفعيل'}</button>
                      <button className="btn btn-sm btn-ghost danger" onClick={() => remove(u)}>حذف</button>
                    </>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <UserModal user={editing === 'new' ? null : editing} isSelf={editing !== 'new' && editing.id === me?.id} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {resetting && <ResetModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function UserModal({ user, isSelf, onClose, onDone }: { user: Profile | null; isSelf: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const isNew = !user;
  const [f, setF] = useState({
    full_name: user?.full_name || '',
    email: user?.email || '',
    password: '',
    role: (user?.role || 'editor') as Role,
    can_manage_videos: user?.can_manage_videos ?? false,
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!f.full_name.trim()) return toast.err('أدخل اسم المستخدم');
    if (isNew) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) return toast.err('البريد الإلكتروني غير صالح');
      if (f.password.length < 8) return toast.err('كلمة المرور المؤقتة يجب ألا تقل عن 8 أحرف');
    }
    setBusy(true);
    try {
      if (isNew) {
        await adminUsers({ action: 'create', email: f.email.trim(), password: f.password, full_name: f.full_name.trim(), role: f.role, can_manage_videos: f.can_manage_videos });
        toast.ok('تم إنشاء المستخدم. أرسل له البريد وكلمة المرور المؤقتة بطريقة آمنة.');
      } else {
        await adminUsers({ action: 'update', id: user!.id, full_name: f.full_name.trim(), role: f.role, can_manage_videos: f.role === 'editor' ? f.can_manage_videos : f.role === 'admin' });
        toast.ok('تم حفظ التعديلات');
      }
      onDone();
    } catch (e) { toast.err(errMsg(e)); }
    finally { setBusy(false); }
  }

  return (
    <Modal title={isNew ? 'إضافة مستخدم' : `تعديل ${user!.email}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>إلغاء</button>
      <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ'}</button>
    </>}>
      <Field label="الاسم"><input value={f.full_name} maxLength={100} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoFocus /></Field>
      {isNew && <>
        <Field label="البريد الإلكتروني"><input type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="كلمة مرور مؤقتة" hint="8 أحرف على الأقل. اطلب من المستخدم تغييرها من صفحة «حسابي» بعد أول دخول.">
          <input type="text" dir="ltr" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
      </>}
      <Field label="الدور" hint={isSelf ? 'لا يمكنك تغيير دورك بنفسك' : ''}>
        <select value={f.role} disabled={isSelf} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </Field>
      {f.role === 'editor' && (
        <label className="switch"><input type="checkbox" checked={f.can_manage_videos} onChange={(e) => setF({ ...f, can_manage_videos: e.target.checked })} /><span>السماح بتعديل الفيديوهات</span></label>
      )}
    </Modal>
  );
}

function ResetModal({ user, onClose }: { user: Profile; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  async function run() {
    if (pw.length < 8) return toast.err('كلمة المرور يجب ألا تقل عن 8 أحرف');
    setBusy(true);
    try {
      await adminUsers({ action: 'reset_password', id: user.id, password: pw });
      toast.ok('تم تعيين كلمة المرور الجديدة');
      onClose();
    } catch (e) { toast.err(errMsg(e)); }
    finally { setBusy(false); }
  }
  return (
    <Modal title={`إعادة تعيين كلمة مرور ${user.email}`} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>إلغاء</button>
      <button className="btn btn-primary" onClick={run} disabled={busy}>تعيين</button>
    </>}>
      <Field label="كلمة المرور الجديدة" hint="أبلغ المستخدم بها بطريقة آمنة واطلب منه تغييرها بعد الدخول">
        <input type="text" dir="ltr" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}
