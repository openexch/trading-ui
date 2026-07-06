// SPDX-License-Identifier: Apache-2.0
import { useEffect, type ReactNode } from 'react';

export type ConfirmTone = 'danger' | 'warning' | 'primary';

// The tri-tone soft treatment: tinted surface + toned text, matching the
// node/service action buttons. Never a solid fill — destructive intent is
// carried by tone, not shouting.
const CONFIRM_BTN: Record<ConfirmTone, string> = {
  danger: 'border border-sell/40 bg-sell-soft text-sell hover:brightness-105',
  warning: 'border border-warn/40 bg-warn-soft text-warn hover:brightness-105',
  primary: 'border border-buy/40 bg-buy-soft text-buy hover:brightness-105',
};

interface ConfirmModalProps {
  title: string;
  body: ReactNode;
  /** danger = destructive, warning = disruptive-but-recoverable, primary = additive. */
  tone: ConfirmTone;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** The one confirm dialog for all admin actions (cluster + risk + backup). */
export function ConfirmModal({
  title,
  body,
  tone,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-overlay-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-hairline bg-surface shadow-lg animate-fade-in">
        <div className="border-b border-hairline px-5 py-3.5">
          <h3 className="font-display text-[15px] font-semibold text-text-strong">{title}</h3>
        </div>
        <div className="px-5 py-4 text-[13px] leading-relaxed text-muted">{body}</div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-hairline px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-hairline-strong hover:text-text disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-[filter] disabled:opacity-50 ${CONFIRM_BTN[tone]}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
