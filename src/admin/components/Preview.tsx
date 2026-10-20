import { useCallback, useEffect, useRef, useState } from 'react';
import { BASE } from '../../shared/env';
import type { PreviewMessage, ScreenSettings, Side, VideoConfig } from '../../shared/types';
import { supabase } from '../supabase';

/**
 * معاينة حيّة لشاشة العرض داخل إطار بمقاس 1920×1080 مصغّر.
 * تُرسل التعديلات غير المحفوظة (draft) للإطار عبر postMessage قبل النشر.
 */
export function ScreenPreview({ date, settings, videos }: {
  date?: string;
  settings?: Partial<ScreenSettings>;
  videos?: Partial<Record<Side, VideoConfig>>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / 1920);
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => { ro?.disconnect(); window.removeEventListener('resize', update); };
  }, []);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin === location.origin && e.data?.type === 'rasmala:preview-ready') setReady(true);
    };
    window.addEventListener('message', on);
    return () => window.removeEventListener('message', on);
  }, []);

  const send = useCallback(async () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    const { data } = await supabase.auth.getSession();
    const msg: PreviewMessage = { type: 'rasmala:preview', token: data.session?.access_token, date, settings, videos };
    w.postMessage(msg, location.origin);
  }, [date, settings, videos]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(send, 250);
    return () => clearTimeout(t);
  }, [ready, send]);

  return (
    <div className="preview" ref={box} style={{ height: 1080 * scale }}>
      <iframe
        ref={frame}
        title="معاينة الشاشة"
        src={`${BASE}display/?preview=1`}
        style={{ width: 1920, height: 1080, transform: `scale(${scale})` }}
        onLoad={() => setTimeout(send, 400)}
      />
    </div>
  );
}
