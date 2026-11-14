// SPDX-License-Identifier: Apache-2.0
/**
 * Popover: a small anchored form or panel (role=dialog, non-modal look).
 *
 * Focus moves in on open and is trapped: Tab and Shift+Tab cycle inside.
 * Esc or a pointer-down outside closes it, and focus returns to where it was
 * (or to `returnFocusRef`). Keyboard events stay inside, so typing a "b" in a
 * price field never reaches a ladder shortcut.
 */
import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  FLOATING_SURFACE,
  focusInitial,
  trapTab,
  useDismissOnOutsidePointer,
  usePlacement,
  useReturnFocus,
} from './overlay';
import type { Anchor, Placement } from './overlay';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  anchor: Anchor;
  /** Accessible name, unless `labelledBy` points at a visible heading. */
  label?: string;
  labelledBy?: string;
  children: ReactNode;
  id?: string;
  placement?: Placement;
  /** Field to focus on open. Defaults to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Pointer-downs inside these never count as "outside" (the trigger). */
  ignoreRefs?: ReadonlyArray<RefObject<HTMLElement | null>>;
  className?: string;
}

export function Popover(props: PopoverProps) {
  if (!props.open) return null;
  return <OpenPopover {...props} />;
}

function OpenPopover({
  onClose,
  anchor,
  label,
  labelledBy,
  children,
  id,
  placement = 'bottom-start',
  initialFocusRef,
  returnFocusRef,
  ignoreRefs,
  className = '',
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const style = usePlacement(true, anchor, ref, placement);

  useReturnFocus(true, ref, returnFocusRef);
  useDismissOnOutsidePointer(true, ref, onClose, ignoreRefs);
  useEffect(() => {
    focusInitial(ref.current, initialFocusRef);
    // Mount-only: re-renders while typing must not move focus.
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    trapTab(e, ref.current);
  };

  return createPortal(
    <div
      ref={ref}
      id={id}
      role="dialog"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      tabIndex={-1}
      style={style}
      onKeyDown={onKeyDown}
      className={`z-50 max-w-[calc(100vw-16px)] rounded-xl p-[18px] outline-none ${FLOATING_SURFACE} ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
