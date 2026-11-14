// SPDX-License-Identifier: Apache-2.0
/**
 * Shared chrome for the side panels: a header row (48 px in a top slot,
 * 40 px in a bottom one) holding the picker and the panel's own controls,
 * over a body that fills the rest of the slot. The body never sizes the
 * slot: the slot's height comes from the layout (DESIGN.md rule 15).
 */
import type { ReactNode } from 'react';

export interface PanelFrameProps {
  /** Accessible name of the panel region. */
  label: string;
  position: 'top' | 'bottom';
  /** Left part of the header: the picker (and tabs, for Orders). */
  header: ReactNode;
  /** Right part of the header: the panel's own buttons. */
  actions?: ReactNode;
  children: ReactNode;
  /** The body scrolls (with a stable gutter) instead of clipping. */
  scroll?: boolean;
}

export function PanelFrame({ label, position, header, actions, children, scroll = true }: PanelFrameProps) {
  return (
    <section aria-label={label} data-panel={label} className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div
        className={`flex flex-none items-center gap-3 border-b border-hairline pl-4 pr-2.5 ${
          position === 'top' ? 'h-12' : 'h-10'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">{header}</div>
        {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
      </div>
      <div className={`min-h-0 flex-1 ${scroll ? 'overflow-y-auto [scrollbar-gutter:stable]' : 'flex flex-col overflow-hidden'}`}>
        {children}
      </div>
    </section>
  );
}

/** The signed-out body of a panel that shows the user's own data. */
export function PanelSignIn({ what, onSignIn }: { what: string; onSignIn: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-6 text-center">
      <span className="text-[12px] text-muted">Sign in to see {what}</span>
      <button
        type="button"
        onClick={onSignIn}
        className="rounded-md bg-accent px-4 py-1.5 text-[12px] font-semibold text-on-accent hover:bg-accent-hover"
      >
        Sign in
      </button>
    </div>
  );
}

/** A quiet one-line note in a panel body. */
export function PanelNote({ children }: { children: ReactNode }) {
  return <div className="px-4 py-6 text-center text-[12px] text-muted">{children}</div>;
}

/** Placeholder for a value the backend does not supply (en dash, never 0). */
export const NONE = '–';
