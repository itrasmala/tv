// عميل Supabase مصغّر لشاشة العرض فقط:
//  - استدعاء RPC عبر fetch مباشرة (بدل حزمة supabase-js كاملة)
//  - Realtime عبر @supabase/realtime-js وحدها
// النتيجة: حجم JavaScript أقل بنحو 4 مرات = تحميل وتشغيل أخف على معالج التلفزيون.
import { RealtimeClient } from '@supabase/realtime-js';

export interface LiteClient {
  rpc<T>(fn: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
  realtime: RealtimeClient;
}

export function createLiteClient(url: string, key: string, token?: string): LiteClient {
  const base = url.replace(/\/+$/, '');
  const bearer = token || key;

  async function rpc<T>(fn: string, args: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = window.setTimeout(() => ctrl?.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(args),
        cache: 'no-store',
        signal: ctrl?.signal,
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  const wsUrl = `${base.replace(/^http/, 'ws')}/realtime/v1`;
  const realtime = new RealtimeClient(wsUrl, {
    params: { apikey: key },
    accessToken: async () => bearer,
  });

  return { rpc, realtime };
}
