// SPDX-License-Identifier: Apache-2.0
/**
 * Shared machinery for the floating primitives (Menu, Popover, Dialog):
 * focus helpers, focus trapping and return, outside-click dismissal, and
 * viewport-clamped placement next to an anchor element or a pointer position.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]',
  '[contenteditable="true"]',
].join(',');

/** Elements Tab can reach inside `root`, in DOM order. */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.tabIndex >= 0 && !el.hasAttribute('inert') && !el.closest('[inert]') && !el.hidden,
  );
}

function isConnected(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected;
}

/**
 * Remember what has focus now and return a function that gives it back.
 *
 * Focus is returned only while it is still inside `container` or has fallen to
 * <body> (the focused node was removed). If the user has already moved focus
 * somewhere else, for example by clicking another input, it stays there.
 */
export function captureReturnFocus(
  container: HTMLElement | null,
  returnFocusRef?: RefObject<HTMLElement | null>,
): () => void {
  const previous = document.activeElement;
  return () => {
    const target = returnFocusRef?.current ?? previous;
    if (!isConnected(target)) return;
    const now = document.activeElement;
    const focusLeft =
      now === null || now === document.body || (container !== null && container.contains(now));
    if (focusLeft) target.focus();
  };
}

/** Hook form of captureReturnFocus for overlays that live while `active`. */
export function useReturnFocus(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  returnFocusRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!active) return;
    return captureReturnFocus(containerRef.current, returnFocusRef);
  }, [active, containerRef, returnFocusRef]);
}

/**
 * Keydown handler that keeps Tab and Shift+Tab inside `container`.
 * Returns true when it handled the event.
 */
export function trapTab(e: ReactKeyboardEvent, container: HTMLElement | null): boolean {
  if (e.key !== 'Tab' || !container) return false;
  const items = getFocusable(container);
  e.preventDefault();
  if (items.length === 0) {
    container.focus();
    return true;
  }
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey
    ? items[i <= 0 ? items.length - 1 : i - 1]
    : items[i === -1 || i === items.length - 1 ? 0 : i + 1];
  next.focus();
  return true;
}

/** Move focus into a freshly opened overlay. */
export function focusInitial(
  container: HTMLElement | null,
  initialFocusRef?: RefObject<HTMLElement | null>,
) {
  if (!container) return;
  const target = initialFocusRef?.current ?? getFocusable(container)[0] ?? container;
  target.focus();
}

/**
 * Close when a pointer goes down outside the overlay. Pointers inside any of
 * `ignore` (usually the trigger, which toggles on its own click) are skipped,
 * so clicking the trigger closes instead of closing and reopening.
 */
export function useDismissOnOutsidePointer(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  ignore: ReadonlyArray<RefObject<HTMLElement | null> | undefined> = [],
) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const ignoreRef = useRef(ignore);
  ignoreRef.current = ignore;

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      if (ignoreRef.current.some((r) => r?.current?.contains(target))) return;
      dismiss.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [active, containerRef]);
}

/** Where a floating element attaches: an element, or a pointer position. */
export type Anchor = RefObject<HTMLElement | null> | { x: number; y: number };

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

const GAP = 4;
const MARGIN = 8;

function anchorRect(anchor: Anchor): { left: number; right: number; top: number; bottom: number } | null {
  if ('current' in anchor) {
    const el = anchor.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }
  return { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
}

/**
 * Fixed-position coordinates for `floatingRef` next to `anchor`. Flips to the
 * other side when the preferred one lacks room and clamps into the viewport
 * with an 8px margin, so a menu opened near an edge is never cut off.
 */
export function usePlacement(
  open: boolean,
  anchor: Anchor,
  floatingRef: RefObject<HTMLElement | null>,
  placement: Placement = 'bottom-start',
): CSSProperties {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const update = useCallback(() => {
    const el = floatingRef.current;
    const a = anchorRect(anchor);
    if (!el || !a) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const [side, align] = placement.split('-') as ['bottom' | 'top', 'start' | 'end'];

    const below = a.bottom + GAP;
    const above = a.top - GAP - h;
    let top: number;
    if (side === 'bottom') top = below + h > vh - MARGIN && above >= MARGIN ? above : below;
    else top = above < MARGIN && below + h <= vh - MARGIN ? below : above;
    let left = align === 'start' ? a.left : a.right - w;

    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - MARGIN - w));
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - MARGIN - h));
    setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }));
  }, [anchor, floatingRef, placement]);

  // Measure before paint on every render (content can change size), and
  // follow the anchor through scrolling and resizing.
  useLayoutEffect(() => {
    if (open) update();
  });
  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, update]);

  return pos
    ? { position: 'fixed', top: pos.top, left: pos.left }
    : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' };
}

/** Shared border, surface and shadow for floating panels. The `--ctl` and
 *  `--shadow-pop` tokens arrive with the new theme; until then the existing
 *  strong hairline and medium elevation stand in. */
export const FLOATING_SURFACE =
  'border border-[color:var(--ctl,var(--hairline-strong))] bg-surface text-text shadow-[var(--shadow-pop,var(--elev-md))]';
