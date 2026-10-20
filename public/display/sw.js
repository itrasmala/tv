// Service Worker لشاشة العرض فقط: يسمح بفتح الشاشة حتى لو أُعيد تشغيل التلفزيون والإنترنت مقطوع.
// - الصفحة: الشبكة أولًا، ثم النسخة المحفوظة عند الانقطاع.
// - ملفات assets (أسماؤها تتغير مع كل نشر): من الذاكرة أولًا.
// - لا يتدخل في طلبات Supabase أو الفيديوهات (نطاقات أخرى).
const CACHE = 'rasmala-display-v1';
const SHELL = './';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(SHELL, { cache: 'reload' }))).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// حذف ملفات النسخ القديمة التي لم تعد الصفحة الحالية تستخدمها
async function prune(html) {
  try {
    const used = new Set((html.match(/[^"'()\s]*\/assets\/[^"'()\s]+/g) || []).map((u) => new URL(u, self.registration.scope).pathname));
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) {
      const p = new URL(req.url).pathname;
      if (p.includes('/assets/') && !used.has(p) && !/\.woff2?$/.test(p)) await cache.delete(req);
    }
  } catch (e) { /* ignore */ }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok) {
          const copy = res.clone();
          const text = await res.clone().text();
          caches.open(CACHE).then((c) => c.put(SHELL, copy)).then(() => prune(text));
        }
        return res;
      } catch (e) {
        const hit = await caches.match(SHELL);
        return hit || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })());
  }
});
