// SPDX-License-Identifier: Apache-2.0
/**
 * Dialog: a modal window (role=dialog, aria-modal).
 *
 * - Focus moves in on open, Tab and Shift+Tab cycle inside, and focus returns
 *   to where it was on close.
 * - The rest of the page is made `inert` while it is open, so neither the
 *   pointer nor assistive technology reaches what is behind it. Nested dialogs
 *   stack: each restores exactly what it changed.
 * - Esc closes it; so does a click on the backdrop unless `dismissOnBackdrop`
 *   is false (use that for a confirm step that must be answered).
 * - Keyboard events stay inside the dialog.
 */
import { useEffect, useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { captureReturnFocus, focusInitial, trapTab } from './overlay';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Visible heading; also the dialog's accessible name. */
  title: ReactNode;
  /** Optional line under the title, linked as the accessible description. */
  description?: ReactNode;
  children: ReactNode;
  /** Extra controls in the header row, before the close button. */
  headerExtra?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  dismissOnBackdrop?: boolean;
  showClose?: boolean;
  /** Tailwind width class for the panel, for example "max-w-[880px]". */
  widthClass?: string;
  className?: string;
}

export function Dialog(props: DialogProps) {
  if (!props.open) return null;
  return <OpenDialog {...props} />;
}

/** Make every other child of <body> inert; returns the undo. */
function inertSiblings(keep: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  for (const el of Array.from(document.body.children)) {
    if (el === keep || !(el instanceof HTMLElement) || el.hasAttribute('inert')) continue;
    el.setAttribute('inert', '');
    changed.push(el);
  }
  return () => changed.forEach((el) => el.removeAttribute('inert'));
}

function OpenDialog({
  onClose,
  title,
  description,
  children,
  headerExtra,
  initialFocusRef,
  returnFocusRef,
  dismissOnBackdrop = true,
  showClose = true,
  widthClass = 'max-w-[560px]',
  className = '',
}: DialogProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    // Order matters: record focus before the page goes inert, and lift inert
    // before giving focus back (an inert element cannot take focus).
    const restoreFocus = captureReturnFocus(panelRef.current, returnFocusRef);
    const backdrop = backdropRef.current;
    const undoInert = backdrop ? inertSiblings(backdrop) : () => {};
    focusInitial(panelRef.current, initialFocusRef);
    return () => {
      undoInert();
      restoreFocus();
    };
    // Mount-only: re-renders must not move focus.
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    trapTab(e, panelRef.current);
  };

  return createPortal(
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 motion-safe:animate-overlay-in"
      onPointerDown={(e) => {
        if (dismissOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`flex max-h-[calc(100dvh-32px)] w-full flex-col overflow-hidden rounded-[14px] border border-[color:var(--ctl,var(--hairline-strong))] bg-surface text-text shadow-lg outline-none ${widthClass} ${className}`}
      >
        <div className="flex flex-none items-center gap-3.5 border-b border-hairline px-5 py-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 id={titleId} className="m-0 truncate font-display text-[20px] font-bold leading-tight text-text-strong">
              {title}
            </h2>
            {description && (
              <p id={descId} className="m-0 text-[12px] text-muted">
                {description}
              </p>
            )}
          </div>
          {headerExtra}
          {showClose && (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="grid h-9 w-9 flex-none cursor-pointer place-items-center rounded-lg border border-[color:var(--ctl,var(--hairline-strong))] bg-transparent text-[16px] text-text hover:border-accent"
            >
              <span aria-hidden>&times;</span>
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
