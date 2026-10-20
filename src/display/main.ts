// =====================================================================
// شاشة العرض العامة (/display) — TypeScript خالص بدون React لتقليل الحمل على التلفزيون.
// المبادئ:
//  1) طلب واحد خفيف (display_snapshot) يجلب كل البيانات.
//  2) Realtime يرسل إشارة عند أي تعديل ← إعادة جلب اللقطة. مع استطلاع دوري احتياطي.
//  3) لا يُعاد رسم إلا الجزء الذي تغيّر، ولا يُعاد تحميل الفيديو إلا إذا تغيّر رابطه.
//  4) آخر بيانات ناجحة تُحفظ محليًا وتُعرض فورًا عند الإقلاع أو انقطاع الإنترنت.
// =====================================================================
import '@fontsource-variable/cairo';
import './display.css';
import type { RealtimeChannel } from '@supabase/realtime-js';
import { createLiteClient, type LiteClient } from './lite';
import { SUPABASE_KEY, SUPABASE_URL, isConfigured } from '../shared/env';
import { DEFAULT_SETTINGS, KIND_LABEL, STATUS_LABEL } from '../shared/labels';
import {
  formatStamp, formatTime, gregorianLong, hijriLong, nowClock, riyadhParts, riyadhToday, toMinutes, weekdayName, digits,
} from '../shared/time';
import type { DisplayTask, PreviewMessage, ScreenSettings, Side, Snapshot, VideoConfig } from '../shared/types';
import { demoSnapshot } from './demo';

// ---------------------------------------------------------------------
// الإعدادات من الرابط
// ---------------------------------------------------------------------
const params = new URLSearchParams(location.search);
const PREVIEW = params.get('preview') === '1';
const DEMO = !isConfigured || params.get('demo') === '1';
const NO_VIDEO = params.get('videos') === '0'; // لاستخدام القسم الأوسط فقط داخل تخطيط Yodeck
const FONT_SCALE = Math.min(1.6, Math.max(0.6, Number(params.get('fs')) || 1));
const CACHE_KEY = 'rasmala:snapshot:v1';
const RELOAD_KEY = 'rasmala:last-reload';
const BOOT_AT = Date.now();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  screen: $('screen'),
  center: $('pane-center'),
  logo: $<HTMLImageElement>('logo'),
  org: $('org'),
  title: $('title'),
  weekday: $('weekday'),
  greg: $('greg'),
  hijri: $('hijri'),
  clock: $('clock'),
  prio: $('prio'),
  prioList: $('prio-list'),
  rows: $('rows'),
  pager: $('pager'),
  notes: $('notes'),
  notesText: $('notes-text'),
  footOrg: $('foot-org'),
  conn: $('conn'),
  connText: $('conn-text'),
  badge: $('mode-badge'),
};

// ---------------------------------------------------------------------
// الحالة
// ---------------------------------------------------------------------
let client: LiteClient | null = null;
let channel: RealtimeChannel | null = null;
let snap: Snapshot | null = null;
let clockOffset = 0; // فرق ساعة التلفزيون عن ساعة الخادم
let lastSyncAt = 0;
let failCount = 0;
let fetching = false;
let refetchQueued = false;
let refetchTimer: number | undefined;
let retryTimer: number | undefined;
let rtConnected = false;
let rtLostAt = 0;

let previewDate: string | undefined;
let previewSettings: Partial<ScreenSettings> | undefined;
let previewVideos: Partial<Record<Side, VideoConfig>> | undefined;
let previewToken: string | undefined;

const keys = { settings: '', videos: '', day: '', tasks: '' };
let settings: ScreenSettings = { ...DEFAULT_SETTINGS } as ScreenSettings;

const now = () => Date.now() + clockOffset;

// ---------------------------------------------------------------------
// أدوات صغيرة
// ---------------------------------------------------------------------
function safe(fn: () => void, label: string) {
  try { fn(); } catch (e) { console.warn('[display]', label, e); }
}
function h(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

// ---------------------------------------------------------------------
// الفيديو: عنصر واحد ثابت لكل جانب لا يُعاد إنشاؤه أبدًا
// ---------------------------------------------------------------------
class VideoPane {
  readonly root: HTMLElement;
  private video: HTMLVideoElement;
  private poster: HTMLImageElement;
  private brand: HTMLElement;
  private src = '';
  private lastTime = -1;
  private stallTicks = 0;
  private errors = 0;
  private retry: number | undefined;

  constructor(id: string) {
    this.root = $(id);
    this.video = this.root.querySelector('video')!;
    this.poster = this.root.querySelector('.vid-poster') as HTMLImageElement;
    this.brand = this.root.querySelector('.brand-name') as HTMLElement;
    const v = this.video;
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.addEventListener('playing', () => { this.errors = 0; this.root.classList.remove('show-fallback'); });
    v.addEventListener('error', () => this.onError());
    // في حال توقف التكرار التلقائي في بعض المشغلات
    v.addEventListener('ended', () => { v.currentTime = 0; this.play(); });
    this.root.classList.add('show-fallback');
  }

  update(cfg: VideoConfig | undefined, visible: boolean, brandName: string) {
    this.brand.textContent = brandName;
    this.root.classList.toggle('fit-contain', cfg?.fit === 'contain');
    const posterUrl = cfg?.poster_url || '';
    if ((this.poster.getAttribute('src') || '') !== posterUrl) {
      if (posterUrl) this.poster.setAttribute('src', posterUrl);
      else this.poster.removeAttribute('src');
    }
    const want = visible && !NO_VIDEO && cfg && cfg.enabled && cfg.url ? cfg.url : '';
    if (want === this.src) return; // نفس الفيديو: لا إعادة تحميل
    this.src = want;
    this.errors = 0;
    clearTimeout(this.retry);
    if (!want) {
      this.stop();
      this.root.classList.add('show-fallback');
      return;
    }
    this.load();
  }

  private load() {
    const v = this.video;
    v.src = this.src;
    v.load();
    this.play();
  }

  private play() {
    try {
      const p = this.video.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* سيعيد المراقب المحاولة */ });
    } catch { /* ignore */ }
  }

  /** تحرير مفكك الفيديو بالكامل عند إخفاء القسم لتوفير موارد التلفزيون */
  private stop() {
    const v = this.video;
    try { v.pause(); } catch { /* ignore */ }
    v.removeAttribute('src');
    try { v.load(); } catch { /* ignore */ }
  }

  private onError() {
    if (!this.src) return;
    this.errors++;
    this.root.classList.add('show-fallback');
    clearTimeout(this.retry);
    const wait = Math.min(30000 * this.errors, 300000);
    this.retry = window.setTimeout(() => { if (this.src) this.load(); }, wait);
  }

  /** يُستدعى كل 20 ثانية: يعيد التشغيل إذا توقف أو علِق الفيديو */
  watchdog() {
    if (!this.src || this.retry && this.errors) return;
    const v = this.video;
    if (v.paused) { this.play(); return; }
    const t = v.currentTime;
    if (Math.abs(t - this.lastTime) < 0.01) {
      this.stallTicks++;
      if (this.stallTicks >= 3) { this.stallTicks = 0; this.load(); }
    } else {
      this.stallTicks = 0;
    }
    this.lastTime = t;
  }
}

const panes: Record<Side, VideoPane> = { right: new VideoPane('pane-right'), left: new VideoPane('pane-left') };

// ---------------------------------------------------------------------
// المقاس: حجم خط أساسي يتناسب مع ارتفاع الشاشة وعرض القسم الأوسط
// ---------------------------------------------------------------------
function fitFont() {
  const W = window.innerWidth || document.documentElement.clientWidth || 1920;
  const H = window.innerHeight || document.documentElement.clientHeight || 1080;
  const sides = NO_VIDEO ? 0 : settings.split_right + settings.split_left;
  const centerPct = NO_VIDEO ? 100 : 100 - sides;
  const centerW = (W * centerPct) / 100;
  const base = Math.min(H / 54, centerW / 46) * FONT_SCALE;
  document.documentElement.style.fontSize = `${Math.max(9, base).toFixed(2)}px`;
}

// ---------------------------------------------------------------------
// تطبيق الإعدادات
// ---------------------------------------------------------------------
function applySettings(s: ScreenSettings) {
  settings = s;
  const root = document.documentElement.style;
  root.setProperty('--primary', s.color_primary);
  root.setProperty('--accent', s.color_accent);
  root.setProperty('--bg', s.color_bg);
  root.setProperty('--prayer', s.color_prayer);
  root.setProperty('--break', s.color_break);

  const r = NO_VIDEO ? 0 : s.split_right;
  const l = NO_VIDEO ? 0 : s.split_left;
  const c = 100 - r - l;
  panes.right.root.style.width = `${r}%`;
  panes.left.root.style.width = `${l}%`;
  el.center.style.width = `${c}%`;
  panes.right.root.hidden = r === 0;
  panes.left.root.hidden = l === 0;
  el.center.classList.toggle('no-right', r === 0);
  el.center.classList.toggle('no-left', l === 0);

  el.org.textContent = s.org_name || '';
  el.footOrg.textContent = s.org_name || '';
  el.title.textContent = s.screen_title || 'جدول العمل اليومي';
  document.title = `${s.screen_title || 'جدول العمل اليومي'} — ${s.org_name || ''}`;
  const logo = s.logo_url || '';
  if ((el.logo.getAttribute('src') || '') !== logo) {
    if (logo) {
      el.logo.onerror = () => { el.logo.hidden = true; };
      el.logo.onload = () => { el.logo.hidden = false; };
      el.logo.setAttribute('src', logo);
    } else {
      el.logo.removeAttribute('src');
      el.logo.hidden = true;
    }
  }
  fitFont();
}

function applyVideos(v: Partial<Record<Side, VideoConfig>>) {
  const brand = settings.org_name || '';
  panes.right.update(v.right, settings.split_right > 0, brand);
  panes.left.update(v.left, settings.split_left > 0, brand);
}

// ---------------------------------------------------------------------
// الأولويات والملاحظات
// ---------------------------------------------------------------------
function renderDay(day: Snapshot['day']) {
  const list = (day?.priorities || []).filter((p) => p && p.trim());
  el.prioList.textContent = '';
  for (let i = 0; i < 3; i++) {
    const li = h('li', 'prio-item' + (list[i] ? '' : ' empty'));
    li.appendChild(h('span', 'prio-num', digits(String(i + 1), settings.numerals)));
    li.appendChild(h('span', 'prio-text', list[i] || '—'));
    el.prioList.appendChild(li);
  }
  el.prio.hidden = list.length === 0 && !day;
  const notes = (day?.notes || '').trim();
  el.notesText.textContent = notes;
  el.notes.hidden = !notes;
}

// ---------------------------------------------------------------------
// جدول المهام + تقسيم الصفحات تلقائيًا حسب المساحة المتاحة
// ---------------------------------------------------------------------
let rowEls: HTMLElement[] = [];
let rowTasks: DisplayTask[] = [];
let pages: number[][] = [];
let pageIndex = 0;
let pageTimer: number | undefined;

function renderTasks(tasks: DisplayTask[]) {
  el.rows.textContent = '';
  rowEls = [];
  rowTasks = tasks;
  if (!tasks.length) {
    el.rows.appendChild(h('div', 'empty-msg', snap ? 'لا توجد مهام مجدولة لهذا اليوم' : 'جارٍ تحميل جدول اليوم…'));
    pages = [];
    updatePager();
    return;
  }
  const fmt = settings.time_format;
  const nu = settings.numerals;
  for (const t of tasks) {
    const row = h('div', `row k-${t.kind} st-${t.status}`);
    const time = h('div', 'c-time', formatTime(t.start_time, fmt, nu));
    if (t.end_time) time.appendChild(h('small', '', 'حتى ' + formatTime(t.end_time, fmt, nu)));
    row.appendChild(time);

    const task = h('div', 'c-task');
    task.appendChild(h('div', 't-title', t.title));
    const meta = h('div', 't-meta');
    if (t.kind !== 'task') meta.appendChild(h('span', `tag tag-${t.kind}`, KIND_LABEL[t.kind]));
    if (settings.show_assignee && t.assignee) meta.appendChild(h('span', '', t.assignee));
    if (meta.childNodes.length) task.appendChild(meta);
    row.appendChild(task);

    const st = h('div', 'c-status');
    const box = h('span', 'box');
    box.innerHTML = CHECK_SVG; // ثابت داخلي، ليس من المستخدم
    st.appendChild(box);
    st.appendChild(h('span', 'pill', STATUS_LABEL[t.status] || ''));
    row.appendChild(st);

    el.rows.appendChild(row);
    rowEls.push(row);
  }
  markNow();
  paginate(true);
}

function paginate(jumpToNow = false) {
  if (!rowEls.length) return;
  rowEls.forEach((r) => r.classList.remove('off'));
  el.pager.hidden = true;
  const avail = el.rows.clientHeight;
  const heights = rowEls.map((r) => r.offsetHeight);
  const total = heights.reduce((a, b) => a + b, 0);
  pages = [];
  if (total <= avail + 1) {
    pages = [rowEls.map((_, i) => i)];
  } else {
    // نترك مساحة لشريط الصفحات
    el.pager.hidden = false;
    el.pager.textContent = 'صفحة 1 من 2';
    const room = el.rows.clientHeight;
    let cur: number[] = [];
    let used = 0;
    heights.forEach((hgt, i) => {
      if (cur.length && used + hgt > room) { pages.push(cur); cur = []; used = 0; }
      cur.push(i);
      used += hgt;
    });
    if (cur.length) pages.push(cur);
  }
  if (jumpToNow) {
    const nowIdx = rowEls.findIndex((r) => r.classList.contains('is-now'));
    const p = nowIdx >= 0 ? pages.findIndex((pg) => pg.includes(nowIdx)) : 0;
    pageIndex = Math.max(0, p);
  }
  if (pageIndex >= pages.length) pageIndex = 0;
  showPage(false);
  clearInterval(pageTimer);
  if (pages.length > 1) {
    pageTimer = window.setInterval(() => {
      pageIndex = (pageIndex + 1) % pages.length;
      showPage(true);
    }, Math.max(5, settings.page_seconds) * 1000);
  }
}

function showPage(animate: boolean) {
  const visible = new Set(pages[pageIndex] || []);
  rowEls.forEach((r, i) => r.classList.toggle('off', !visible.has(i)));
  if (animate) {
    el.rows.classList.remove('page-in');
    void el.rows.offsetWidth; // إعادة تشغيل الحركة الخفيفة
    el.rows.classList.add('page-in');
  }
  updatePager();
}

function updatePager() {
  el.pager.textContent = '';
  if (pages.length <= 1) { el.pager.hidden = true; return; }
  el.pager.hidden = false;
  el.pager.appendChild(h('span', '', digits(`صفحة ${pageIndex + 1} من ${pages.length}`, settings.numerals)));
  pages.forEach((_, i) => el.pager.appendChild(h('span', 'dot' + (i === pageIndex ? ' on' : ''))));
}

/** تمييز المهمة الجارية الآن */
function markNow() {
  if (!rowEls.length || !snap) return;
  const isToday = snap.date === riyadhToday(now());
  const p = riyadhParts(now());
  const mins = p.hh * 60 + p.mm;
  rowTasks.forEach((t, i) => {
    const s = toMinutes(t.start_time);
    const e = toMinutes(t.end_time);
    const active = isToday && s !== null && mins >= s && (e === null ? mins < s + 30 : mins < e);
    const row = rowEls[i];
    if (row.classList.contains('is-now') === active) return;
    row.classList.toggle('is-now', active);
    const meta = row.querySelector('.t-meta');
    const existing = row.querySelector('.tag-now');
    if (active && !existing) {
      const tag = h('span', 'tag tag-now', 'الآن');
      if (meta) meta.insertBefore(tag, meta.firstChild);
      else { const m = h('div', 't-meta'); m.appendChild(tag); row.querySelector('.c-task')!.appendChild(m); }
    } else if (!active && existing) {
      const m = existing.parentElement!;
      existing.remove();
      if (!m.childNodes.length) m.remove();
    }
  });
}

// ---------------------------------------------------------------------
// الساعة والتاريخ
// ---------------------------------------------------------------------
let lastDateKey = '';
function renderClock() {
  const ms = now();
  const date = snap?.date || riyadhToday(ms);
  const key = `${date}|${settings.numerals}|${settings.show_hijri}`;
  if (key !== lastDateKey) {
    lastDateKey = key;
    el.weekday.textContent = weekdayName(date);
    el.greg.textContent = gregorianLong(date, settings.numerals);
    el.hijri.textContent = settings.show_hijri ? hijriLong(date, settings.numerals) : '';
    el.hijri.hidden = !settings.show_hijri;
  }
  el.clock.textContent = nowClock(ms, settings.time_format, settings.numerals);
}

// ---------------------------------------------------------------------
// تطبيق اللقطة مع إعادة رسم الأجزاء المتغيرة فقط
// ---------------------------------------------------------------------
function applySnapshot(data: Snapshot) {
  snap = data;
  const s: ScreenSettings = { ...(DEFAULT_SETTINGS as ScreenSettings), ...(data.settings || {}), ...(previewSettings || {}) };
  const v = { ...(data.videos || {}), ...(previewVideos || {}) };
  const sKey = JSON.stringify(s);
  const vKey = JSON.stringify(v) + sKey.length + s.split_left + s.split_right + s.org_name;
  const dKey = JSON.stringify(data.day);
  const tKey = JSON.stringify(data.tasks);
  const settingsChanged = sKey !== keys.settings;

  if (settingsChanged) { keys.settings = sKey; safe(() => applySettings(s), 'settings'); lastDateKey = ''; }
  if (vKey !== keys.videos) { keys.videos = vKey; safe(() => applyVideos(v), 'videos'); }
  if (dKey !== keys.day || settingsChanged) { keys.day = dKey; safe(() => renderDay(data.day), 'day'); }
  if (tKey !== keys.tasks || settingsChanged) { keys.tasks = tKey; safe(() => renderTasks(data.tasks || []), 'tasks'); }
  else if (settingsChanged) safe(() => paginate(), 'paginate');
  safe(renderClock, 'clock');
}

// ---------------------------------------------------------------------
// الاتصال والمزامنة
// ---------------------------------------------------------------------
function makeClient(token?: string) {
  if (client) { try { client.realtime.disconnect(); } catch { /* ignore */ } }
  return createLiteClient(SUPABASE_URL, SUPABASE_KEY, token);
}

function setOnline(ok: boolean) {
  if (ok) {
    el.conn.hidden = true;
    return;
  }
  el.conn.hidden = false;
  el.connText.textContent = lastSyncAt
    ? `غير متصل — يُعرض آخر جدول محفوظ (${formatStamp(new Date(lastSyncAt).toISOString(), false)})`
    : 'غير متصل — بانتظار الاتصال';
}

function saveCache(data: Snapshot) {
  if (PREVIEW) return;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* ignore */ }
}

function loadCache(): boolean {
  if (PREVIEW) return false;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const { savedAt, data } = JSON.parse(raw) as { savedAt: number; data: Snapshot };
    lastSyncAt = savedAt;
    // بيانات يوم سابق: نحتفظ بالإعدادات والفيديو فقط، ولا نعرض مهام قديمة
    if (data.date !== riyadhToday()) {
      applySnapshot({ ...data, date: riyadhToday(), day: null, tasks: [] });
      snap = null;
      renderTasks([]);
    } else {
      applySnapshot(data);
    }
    return true;
  } catch {
    return false;
  }
}

function scheduleRefetch(delay = 600) {
  clearTimeout(refetchTimer);
  refetchTimer = window.setTimeout(() => fetchSnapshot(), delay);
}

async function fetchSnapshot(): Promise<void> {
  if (DEMO) {
    applySnapshot(demoSnapshot(riyadhToday(now())));
    return;
  }
  if (!client) return;
  if (fetching) { refetchQueued = true; return; }
  fetching = true;
  clearTimeout(retryTimer);
  try {
    const t0 = Date.now();
    const args = previewDate ? { p_date: previewDate } : {};
    const snapData = await withTimeout(client.rpc<Snapshot>('display_snapshot', args), 16000);
    const t1 = Date.now();
    const serverMs = Date.parse(snapData.server_time);
    if (!Number.isNaN(serverMs)) clockOffset = serverMs - (t0 + t1) / 2;
    lastSyncAt = Date.now();
    failCount = 0;
    setOnline(true);
    applySnapshot(snapData);
    saveCache(snapData);
  } catch (e) {
    failCount++;
    console.warn('[display] fetch failed', e);
    setOnline(false);
    const wait = Math.min(15000 * Math.pow(2, failCount - 1), 120000);
    retryTimer = window.setTimeout(() => fetchSnapshot(), wait);
  } finally {
    fetching = false;
    if (refetchQueued) { refetchQueued = false; scheduleRefetch(300); }
  }
}

function connectRealtime() {
  if (!client || DEMO) return;
  if (channel) { try { client.realtime.removeChannel(channel); } catch { /* ignore */ } channel = null; }
  rtConnected = false;
  rtLostAt = Date.now();
  channel = client.realtime
    .channel('rasmala-screen-signal')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'screen_signal' }, () => scheduleRefetch(500))
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        const wasDown = !rtConnected;
        rtConnected = true;
        if (wasDown) scheduleRefetch(200); // تعويض ما فات أثناء الانقطاع
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (rtConnected) rtLostAt = Date.now();
        rtConnected = false;
      }
    });
}

// ---------------------------------------------------------------------
// المؤقتات
// ---------------------------------------------------------------------
function minuteTick() {
  safe(renderClock, 'clock');
  safe(markNow, 'now');
  const ms = now();
  const p = riyadhParts(ms);

  // انتقال اليوم عند منتصف الليل
  if (!PREVIEW && snap && snap.date !== riyadhToday(ms)) scheduleRefetch(1500);

  // إعادة تحميل ليلية خفيفة لتنظيف الذاكرة واستلام آخر نسخة من التطبيق
  if (!PREVIEW && settings.reload_hour !== null && p.hh === settings.reload_hour && p.mm < 5 && navigator.onLine) {
    const today = riyadhToday(ms);
    let last = '';
    try { last = localStorage.getItem(RELOAD_KEY) || ''; } catch { /* ignore */ }
    if (last !== today && Date.now() - BOOT_AT > 10 * 60 * 1000) {
      try { localStorage.setItem(RELOAD_KEY, today); } catch { /* ignore */ }
      location.reload();
    }
  }
}

function startTimers() {
  // الساعة تتحدث مع بداية كل دقيقة فقط (لا عدّاد ثوانٍ يستهلك المعالج)
  const toNextMinute = 60000 - (now() % 60000) + 50;
  window.setTimeout(() => { minuteTick(); window.setInterval(minuteTick, 60000); }, toNextMinute);

  // مراقبة الفيديو
  window.setInterval(() => { panes.right.watchdog(); panes.left.watchdog(); }, 20000);

  // استطلاع احتياطي: كل دقيقة إذا انقطع Realtime، وكل 5 دقائق في الوضع الطبيعي
  window.setInterval(() => {
    if (DEMO) return;
    const age = Date.now() - lastSyncAt;
    if (!rtConnected || age > 5 * 60 * 1000) fetchSnapshot();
    // إعادة إنشاء قناة Realtime إن بقيت معطلة أكثر من 3 دقائق
    if (!rtConnected && Date.now() - rtLostAt > 3 * 60 * 1000) connectRealtime();
  }, 60000);
}

// ---------------------------------------------------------------------
// المعاينة من لوحة الإدارة
// ---------------------------------------------------------------------
function listenPreview() {
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.origin !== location.origin) return;
    const msg = ev.data as PreviewMessage;
    if (!msg || msg.type !== 'rasmala:preview') return;
    if (msg.token && msg.token !== previewToken && !DEMO) {
      previewToken = msg.token;
      client = makeClient(msg.token);
      connectRealtime();
    }
    previewDate = msg.date;
    previewSettings = msg.settings;
    previewVideos = msg.videos;
    keys.settings = keys.videos = '';
    fetchSnapshot();
  });
  // إبلاغ اللوحة بأن الإطار جاهز
  try { window.parent.postMessage({ type: 'rasmala:preview-ready' }, location.origin); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------
// الإقلاع
// ---------------------------------------------------------------------
function boot() {
  window.addEventListener('error', (e) => console.warn('[display] error', e.message));
  window.addEventListener('unhandledrejection', (e) => { console.warn('[display] rejection', e.reason); e.preventDefault(); });

  if (DEMO) { el.badge.hidden = false; el.badge.textContent = isConfigured ? 'وضع تجريبي' : 'وضع تجريبي — لم تُربط قاعدة البيانات بعد'; }
  if (PREVIEW) { el.badge.hidden = false; el.badge.textContent = 'معاينة'; listenPreview(); }

  applySettings(settings);
  renderClock();
  const hadCache = loadCache();
  if (!hadCache) renderTasks([]);

  if (!DEMO) {
    client = makeClient();
    connectRealtime();
  }
  fetchSnapshot();
  startTimers();

  let resizeT: number | undefined;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(() => { fitFont(); paginate(); }, 250);
  });
  window.addEventListener('online', () => scheduleRefetch(500));
  window.addEventListener('offline', () => setOnline(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefetch(300); });

  // التشغيل دون إنترنت بعد إعادة تشغيل الشاشة
  if (!PREVIEW && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[display] sw', e));
  }

  // إعادة حساب الصفحات بعد تحميل الخط (يتغير ارتفاع الأسطر)
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts && fonts.ready) fonts.ready.then(() => safe(() => paginate(true), 'fonts'));
}

boot();
