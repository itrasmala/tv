import { createClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL, isConfigured } from '../shared/env';

// عميل لوحة الإدارة: يحفظ الجلسة في المتصفح ويجددها تلقائيًا.
export const supabase = createClient(
  isConfigured ? SUPABASE_URL : 'https://not-configured.supabase.co',
  isConfigured ? SUPABASE_KEY : 'not-configured-key-not-configured-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

/** تحويل أخطاء Supabase/الشبكة إلى رسائل عربية مفهومة */
export function errMsg(e: unknown): string {
  const anyE = e as { message?: string; code?: string; status?: number } | null;
  const msg = anyE?.message || String(e || '');
  const code = anyE?.code || '';
  if (/Failed to fetch|NetworkError|network|Load failed|timeout/i.test(msg)) return 'تعذّر الاتصال بالخادم. تحقّق من الإنترنت ثم أعد المحاولة.';
  if (/Invalid login credentials/i.test(msg)) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة.';
  if (/Email not confirmed/i.test(msg)) return 'لم يتم تأكيد البريد الإلكتروني بعد.';
  if (/User is banned|banned/i.test(msg)) return 'هذا الحساب معطّل. تواصل مع المدير العام.';
  if (/rate limit|too many/i.test(msg)) return 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.';
  if (/JWT expired|invalid jwt|session/i.test(msg) && /expired|invalid/i.test(msg)) return 'انتهت الجلسة. سجّل الدخول من جديد.';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) {
    return /[؀-ۿ]/.test(msg) ? msg : 'ليست لديك صلاحية لتنفيذ هذا الإجراء.';
  }
  if (code === '23505' || /duplicate key/i.test(msg)) return 'يوجد عنصر بنفس الاسم مسبقًا.';
  if (/tasks_time_order/.test(msg)) return 'وقت النهاية يجب أن يكون بعد وقت البداية.';
  if (/split_sum_100/.test(msg)) return 'مجموع نسب الأقسام يجب أن يساوي 100%.';
  if (code === '23514' || /check constraint/i.test(msg)) return 'بعض البيانات المدخلة غير صالحة. راجع الحقول وأعد المحاولة.';
  if (/Payload too large|exceeded the maximum allowed size|too large/i.test(msg)) return 'حجم الملف أكبر من المسموح.';
  if (/mime type|invalid_mime/i.test(msg)) return 'نوع الملف غير مسموح.';
  if (/(mode|slide_urls|slide_seconds)/.test(msg) && /column|schema cache/i.test(msg)) return 'ميزة عرض الشرائح تحتاج تشغيل الملف supabase/migrations/002_slides.sql في Supabase أولًا.';
  if (/[؀-ۿ]/.test(msg)) return msg;
  return 'حدث خطأ غير متوقع: ' + msg;
}

/** استدعاء دالة إدارة المستخدمين على الخادم */
export async function adminUsers<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let detail = '';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') detail = (await ctx.json()).error || '';
    } catch { /* ignore */ }
    if (detail) throw new Error(detail);
    if (/Failed to send|Function not found|404/i.test(error.message)) {
      throw new Error('دالة إدارة المستخدمين غير منشورة بعد على Supabase (admin-users). راجع دليل الإعداد.');
    }
    throw error;
  }
  if (data && (data as { error?: string }).error) throw new Error((data as { error: string }).error);
  return data as T;
}

/** التأكد من أن التحديث أصاب صفًا فعلًا (RLS يُرجع 0 صفوف بصمت عند عدم الصلاحية) */
export function ensureRows<T>(rows: T[] | null): T[] {
  if (!rows || rows.length === 0) throw new Error('ليست لديك صلاحية لتنفيذ هذا الإجراء، أو أن العنصر لم يعد موجودًا.');
  return rows;
}
