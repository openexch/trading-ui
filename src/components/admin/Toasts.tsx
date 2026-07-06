// SPDX-License-Identifier: Apache-2.0
// Admin-scoped toast stack. Action results surface here — overlay-positioned
// bottom-right so appearing/disappearing toasts never shift the layout
// (banners that push content down are an anti-flicker violation).
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  tone: ToastTone;
  text: string;
  /** Sticky toasts stay until dismissed — for errors the operator must see. */
  sticky?: boolean;
}

interface Toast extends ToastInput {
  id: number;
}

const AUTO_DISMISS_MS = 4500;
const MAX_STACK = 4;

const ToastCtx = createContext<(t: ToastInput) => void>(() => {});

/** Push a toast: `toast({ tone: 'error', text: '...', sticky: true })`. */
export const useToast = () => useContext(ToastCtx);

// Materials, not decoration: surface + hairline + a semantic left rule,
// the same device as the node-card state borders.
const TOAST_RULE: Record<ToastTone, string> = {
  success: 'border-l-buy',
  error: 'border-l-sell',
  info: 'border-l-accent',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((t: ToastInput) => {
    const id = ++idRef.current; // monotonic id = stable key, no remount churn
    setToasts(prev => [...prev.slice(-(MAX_STACK - 1)), { ...t, id }]);
    if (!t.sticky) window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map(t => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-md border border-l-[3px] border-hairline bg-surface px-3.5 py-2.5 text-[13px] shadow-md animate-fade-in ${TOAST_RULE[t.tone]}`}
          >
            <span className="flex-1 break-words text-text">{t.text}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="text-faint transition-colors hover:text-text"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
