export const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const SUPABASE_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/** هل تم ضبط مفاتيح Supabase أثناء البناء؟ */
// يُسمح بـ http فقط للتجربة المحلية على localhost
export const isConfigured =
  /^(https:\/\/.+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)/.test(SUPABASE_URL) && SUPABASE_KEY.length > 20 && !/YOUR-/.test(SUPABASE_URL + SUPABASE_KEY);

/** المسار الأساسي للموقع (ينتهي بـ /) — مثال: /rasmala-smart-display/ */
export const BASE = import.meta.env.BASE_URL;

export const displayUrl = () => new URL(`${BASE}display/`, location.origin).toString();
export const adminUrl = () => new URL(`${BASE}admin/`, location.origin).toString();
