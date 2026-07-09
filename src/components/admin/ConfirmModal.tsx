// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState, type ReactNode } from 'react';

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
  /** Typed confirmation: the confirm button stays disabled until the operator
   *  types this phrase exactly. Reserved for data-loss operations (topology
   *  re-forms) — a click is too cheap for a wipe. */
  requireText?: string;
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
  requireText,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [typed, setTyped] = useState('');
  const confirmBlocked = !!requireText && typed !== requireText;
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
        {requireText && (
          <div className="px-5 pb-4">
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-faint">
              Type <span className="select-all font-mono text-sell">{requireText}</span> to confirm
            </label>
            <input
              type="text"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireText}
              disabled={busy}
              aria-label="Confirmation phrase"
              className="w-full rounded-md border border-hairline bg-surface-2 px-3 py-1.5 font-mono text-[13px] text-text placeholder:text-faint focus:border-sell/50 focus:outline-none disabled:opacity-50"
            />
          </div>
        )}
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
            disabled={busy || confirmBlocked}
            className={`rounded-md px-3 py-1.5 text-[13px] font-semibold transition-[filter] disabled:opacity-50 ${CONFIRM_BTN[tone]}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
