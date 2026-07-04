// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';

interface ConfirmModalProps {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' styles the confirm button as destructive. */
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Reusable confirm dialog for admin actions (risk + backup ops). */
export function ConfirmModal({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
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
            className="rounded-md border border-hairline px-3 py-1.5 text-[13px] text-muted hover:border-hairline-strong hover:text-text disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 ${
              tone === 'danger' ? 'bg-sell text-white hover:brightness-110' : 'bg-accent text-on-accent hover:bg-accent-hover'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
