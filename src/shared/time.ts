// أدوات التاريخ والوقت بتوقيت الرياض (UTC+3 ثابت، لا يوجد توقيت صيفي في السعودية).
// نتجنب الاعتماد على قاعدة المناطق الزمنية في متصفح التلفزيون لأنها قد تكون ناقصة.
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface RiyadhParts { y: number; m: number; d: number; hh: number; mm: number; ss: number; }

export function riyadhParts(ms: number = Date.now()): RiyadhParts {
  const t = new Date(ms + RIYADH_OFFSET_MS);
  return {
    y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(),
    hh: t.getUTCHours(), mm: t.getUTCMinutes(), ss: t.getUTCSeconds(),
  };
}

const pad = (n: number) => (n < 10 ? '0' + n : String(n));

export function isoDate(p: { y: number; m: number; d: number }): string {
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function riyadhToday(ms: number = Date.now()): string {
  return isoDate(riyadhParts(ms));
}

/** يضيف أيامًا لتاريخ بصيغة YYYY-MM-DD */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** دقائق منذ منتصف الليل من "HH:MM" */
export function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export function digits(s: string, numerals: 'latn' | 'arab' = 'latn'): string {
  if (numerals !== 'arab') return s;
  return s.replace(/[0-9]/g, (c) => ARABIC_DIGITS[Number(c)]);
}

/** "13:30" → "1:30 م" أو "13:30" */
export function formatTime(hhmm: string | null | undefined, format: '12' | '24' = '12', numerals: 'latn' | 'arab' = 'latn'): string {
  if (!hhmm) return '';
  const [hRaw, m] = hhmm.split(':');
  const h = Number(hRaw);
  if (format === '24') return digits(`${pad(h)}:${m}`, numerals);
  const suffix = h < 12 ? 'ص' : 'م';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return digits(`${h12}:${m}`, numerals) + ' ' + suffix;
}

function noonUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fmt(locale: string, opts: Intl.DateTimeFormatOptions, date: Date): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }).format(date);
  } catch {
    return '';
  }
}

const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function weekdayName(iso: string): string {
  return WEEKDAYS[noonUtc(iso).getUTCDay()];
}

/** "20 أكتوبر 2026" */
export function gregorianLong(iso: string, numerals: 'latn' | 'arab' = 'latn'): string {
  const [y, m, d] = iso.split('-').map(Number);
  return digits(`${d} ${MONTHS[m - 1]} ${y}`, numerals);
}

/** التاريخ الهجري (تقويم أم القرى) إن كان المتصفح يدعمه */
export function hijriLong(iso: string, numerals: 'latn' | 'arab' = 'latn'): string {
  const nu = numerals === 'arab' ? 'arab' : 'latn';
  const date = noonUtc(iso);
  let s = fmt(`ar-SA-u-ca-islamic-umalqura-nu-${nu}`, { day: 'numeric', month: 'long', year: 'numeric' }, date);
  if (!s || /\d{4}\s*م/.test(s)) s = fmt(`ar-u-ca-islamic-nu-${nu}`, { day: 'numeric', month: 'long', year: 'numeric' }, date);
  if (!s) return '';
  return s.includes('هـ') ? s : s + ' هـ';
}

export function nowClock(ms: number, format: '12' | '24', numerals: 'latn' | 'arab'): string {
  const p = riyadhParts(ms);
  return formatTime(`${pad(p.hh)}:${pad(p.mm)}`, format, numerals);
}

/** "2026-10-20T10:00:00Z" → "10:00 ص — 20 أكتوبر" بتوقيت الرياض */
export function formatStamp(ts: string | null | undefined, withDate = true): string {
  if (!ts) return '';
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) return '';
  const p = riyadhParts(ms);
  const time = formatTime(`${pad(p.hh)}:${pad(p.mm)}`, '12');
  return withDate ? `${time} — ${p.d} ${MONTHS[p.m - 1]} ${p.y}` : time;
}
