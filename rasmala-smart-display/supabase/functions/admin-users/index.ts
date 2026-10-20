// =====================================================================
// Edge Function: admin-users
// إدارة المستخدمين (إضافة، تعديل الدور، تعطيل، إعادة تعيين كلمة المرور، حذف)
// تعمل على خوادم Supabase وتستخدم مفتاح الخدمة السري — لا يصل هذا المفتاح للمتصفح أبدًا.
// تتحقق بنفسها من أن المستدعي «مدير عام» نشط قبل أي عملية.
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
// اختياري: قيّد الوصول لنطاق موقعك، مثال: https://username.github.io
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (message: string, status = 400) => json({ error: message }, status);

const ROLES = ['admin', 'editor', 'viewer'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail('Method not allowed', 405);
  if (!SERVICE_KEY) return fail('مفتاح الخدمة غير مضبوط في أسرار الدالة', 500);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) التحقق من هوية المستدعي
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return fail('يلزم تسجيل الدخول', 401);
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  const caller = authData?.user;
  if (authErr || !caller) return fail('جلسة غير صالحة، سجّل الدخول من جديد', 401);

  const { data: me } = await admin
    .from('profiles').select('role, is_active, email, full_name').eq('id', caller.id).single();
  if (!me || me.role !== 'admin' || !me.is_active) return fail('هذه العملية للمدير العام فقط', 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('طلب غير صالح'); }
  const action = String(body.action ?? '');

  const audit = async (act: 'insert' | 'update' | 'delete', recordId: string, summary: string, oldData: unknown, newData: unknown) => {
    await admin.from('audit_log').insert({
      actor_id: caller.id, actor_email: me.email, actor_name: me.full_name,
      action: act, entity: 'profiles', record_id: recordId, summary,
      old_data: oldData ?? null, new_data: newData ?? null,
    });
  };

  const countActiveAdmins = async (exceptId: string) => {
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
      .eq('role', 'admin').eq('is_active', true).neq('id', exceptId);
    return count ?? 0;
  };

  try {
    switch (action) {
      // ---------------------------------------------------------------
      case 'list': {
        const { data: profiles, error } = await admin.from('profiles').select('*').order('created_at');
        if (error) throw error;
        const lastSignIn: Record<string, string | null> = {};
        let page = 1;
        while (page < 20) {
          const { data, error: e } = await admin.auth.admin.listUsers({ page, perPage: 200 });
          if (e) break;
          data.users.forEach((u) => (lastSignIn[u.id] = u.last_sign_in_at ?? null));
          if (data.users.length < 200) break;
          page++;
        }
        return json({ users: profiles.map((p) => ({ ...p, last_sign_in_at: lastSignIn[p.id] ?? null })) });
      }

      // ---------------------------------------------------------------
      case 'create': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const password = String(body.password ?? '');
        const fullName = String(body.full_name ?? '').trim().slice(0, 100);
        const role = String(body.role ?? 'viewer');
        const canVideos = Boolean(body.can_manage_videos);
        if (!EMAIL_RE.test(email)) return fail('البريد الإلكتروني غير صالح');
        if (password.length < 8) return fail('كلمة المرور يجب ألا تقل عن 8 أحرف');
        if (!ROLES.includes(role as typeof ROLES[number])) return fail('الدور غير صالح');

        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { full_name: fullName },
        });
        if (error) {
          if (/already|registered|exists/i.test(error.message)) return fail('هذا البريد مسجّل مسبقًا');
          throw error;
        }
        const id = data.user!.id;
        const profile = { id, email, full_name: fullName, role, can_manage_videos: role === 'editor' ? canVideos : role === 'admin', is_active: true };
        const { error: pErr } = await admin.from('profiles').upsert(profile);
        if (pErr) throw pErr;
        await audit('insert', id, email, null, profile);
        return json({ ok: true, id });
      }

      // ---------------------------------------------------------------
      case 'update': {
        const id = String(body.id ?? '');
        if (!UUID_RE.test(id)) return fail('معرّف غير صالح');
        const { data: before } = await admin.from('profiles').select('*').eq('id', id).single();
        if (!before) return fail('المستخدم غير موجود', 404);

        const patch: Record<string, unknown> = {};
        if (body.full_name !== undefined) patch.full_name = String(body.full_name).trim().slice(0, 100);
        if (body.role !== undefined) {
          if (!ROLES.includes(String(body.role) as typeof ROLES[number])) return fail('الدور غير صالح');
          patch.role = String(body.role);
        }
        if (body.can_manage_videos !== undefined) patch.can_manage_videos = Boolean(body.can_manage_videos);
        if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

        if (id === caller.id && (patch.role && patch.role !== 'admin' || patch.is_active === false)) {
          return fail('لا يمكنك خفض صلاحيتك أو تعطيل حسابك بنفسك');
        }
        const losingAdmin = before.role === 'admin' && before.is_active &&
          ((patch.role && patch.role !== 'admin') || patch.is_active === false);
        if (losingAdmin && (await countActiveAdmins(id)) === 0) return fail('لا يمكن إزالة آخر مدير عام نشط');

        const { data: after, error } = await admin.from('profiles').update(patch).eq('id', id).select().single();
        if (error) throw error;

        if (patch.is_active !== undefined && patch.is_active !== before.is_active) {
          // الحظر يمنع تجديد الجلسة؛ والتحقق من is_active في قاعدة البيانات يمنع الوصول فورًا
          await admin.auth.admin.updateUserById(id, { ban_duration: patch.is_active ? 'none' : '876000h' });
        }
        await audit('update', id, before.email, before, after);
        return json({ ok: true, user: after });
      }

      // ---------------------------------------------------------------
      case 'reset_password': {
        const id = String(body.id ?? '');
        const password = String(body.password ?? '');
        if (!UUID_RE.test(id)) return fail('معرّف غير صالح');
        if (password.length < 8) return fail('كلمة المرور يجب ألا تقل عن 8 أحرف');
        const { error } = await admin.auth.admin.updateUserById(id, { password });
        if (error) throw error;
        const { data: p } = await admin.from('profiles').select('email').eq('id', id).single();
        await audit('update', id, `${p?.email ?? id} — إعادة تعيين كلمة المرور`, null, null);
        return json({ ok: true });
      }

      // ---------------------------------------------------------------
      case 'delete': {
        const id = String(body.id ?? '');
        if (!UUID_RE.test(id)) return fail('معرّف غير صالح');
        if (id === caller.id) return fail('لا يمكنك حذف حسابك بنفسك');
        const { data: before } = await admin.from('profiles').select('*').eq('id', id).single();
        if (!before) return fail('المستخدم غير موجود', 404);
        if (before.role === 'admin' && before.is_active && (await countActiveAdmins(id)) === 0) {
          return fail('لا يمكن حذف آخر مدير عام نشط');
        }
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw error;
        await audit('delete', id, before.email, before, null);
        return json({ ok: true });
      }

      default:
        return fail('إجراء غير معروف');
    }
  } catch (e) {
    console.error(e);
    return fail('تعذّر تنفيذ العملية: ' + (e instanceof Error ? e.message : String(e)), 500);
  }
});
