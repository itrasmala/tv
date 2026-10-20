import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------
// إشعارات منبثقة (Toast)
// ---------------------------------------------------------------------
type ToastKind = 'ok' | 'err' | 'info';
interface ToastItem { id: number; kind: ToastKind; text: string; }
interface ToastApi { ok: (t: string) => void; err: (t: string) => void; info: (t: string) => void; }

const ToastCtx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3500);
  }, []);
  const api = useRef<ToastApi>({
    ok: (t) => push('ok', t),
    err: (t) => push('err', t),
    info: (t) => push('info', t),
  });
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast outside provider');
  return v;
}

// ---------------------------------------------------------------------
// نافذة منبثقة عامة
// ---------------------------------------------------------------------
export function Modal({ title, onClose, children, footer, wide }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('modal-open'); };
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' modal-wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// تأكيد العمليات الحساسة (الحذف وغيره)
// ---------------------------------------------------------------------
interface ConfirmOpts { title: string; text: string; confirmText?: string; danger?: boolean; }
type ConfirmFn = (o: ConfirmOpts) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && (
        <Modal
          title={state.title}
          onClose={() => close(false)}
          footer={
            <>
              <button className="btn" onClick={() => close(false)}>إلغاء</button>
              <button className={'btn ' + (state.danger ? 'btn-danger' : 'btn-primary')} onClick={() => close(true)} autoFocus>
                {state.confirmText || 'تأكيد'}
              </button>
            </>
          }
        >
          <p className="confirm-text">{state.text}</p>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const v = useContext(ConfirmCtx);
  if (!v) throw new Error('useConfirm outside provider');
  return v;
}

// ---------------------------------------------------------------------
// عناصر صغيرة
// ---------------------------------------------------------------------
export const Spinner = ({ label }: { label?: string }) => (
  <div className="spinner-wrap"><span className="spinner" />{label && <span>{label}</span>}</div>
);

export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function Field({ label, hint, children, error }: { label: string; hint?: string; children: ReactNode; error?: string }) {
  return (
    <label className={'field' + (error ? ' has-error' : '')}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function ReadOnlyNote() {
  return <div className="note note-info">صلاحيتك «مشاهد فقط» — يمكنك الاطلاع دون تعديل.</div>;
}
