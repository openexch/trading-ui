// SPDX-License-Identifier: Apache-2.0
/**
 * Menu: a floating list of actions (role=menu).
 *
 * - Roving focus: one item holds tabindex 0; ArrowUp/ArrowDown move (wrapping),
 *   Home/End jump, a printable key jumps to the next item starting with it.
 * - Esc closes and returns focus to the trigger. Tab closes too (a menu is not
 *   a tab stop of its own).
 * - Choosing an item runs its action and closes the menu.
 * - Keyboard events stay inside the menu, so a ladder or page shortcut never
 *   fires while a menu has focus.
 *
 * Anchor it to a trigger element (`useMenuTrigger` wires the button) or to a
 * pointer position for a context menu.
 */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
  FLOATING_SURFACE,
  useDismissOnOutsidePointer,
  usePlacement,
  useReturnFocus,
} from './overlay';
import type { Anchor, Placement } from './overlay';

const ITEM_SELECTOR = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"]';

function enabledItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
    (el) => el.getAttribute('aria-disabled') !== 'true',
  );
}

interface MenuContextValue {
  close: () => void;
}
const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuProps {
  open: boolean;
  onClose: () => void;
  anchor: Anchor;
  /** Accessible name, for example "Orders at 97,380". */
  label: string;
  children: ReactNode;
  id?: string;
  placement?: Placement;
  /** Which item gets focus on open (ArrowUp on a trigger opens at the end). */
  initialFocus?: 'first' | 'last';
  /** Where focus goes on close. Defaults to whatever had focus at open. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Pointer-downs inside these never count as "outside" (the trigger). */
  ignoreRefs?: ReadonlyArray<RefObject<HTMLElement | null>>;
  className?: string;
}

export function Menu(props: MenuProps) {
  if (!props.open) return null;
  return <OpenMenu {...props} />;
}

function OpenMenu({
  onClose,
  anchor,
  label,
  children,
  id,
  placement = 'bottom-start',
  initialFocus = 'first',
  returnFocusRef,
  ignoreRefs,
  className = '',
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const style = usePlacement(true, anchor, ref, placement);

  useReturnFocus(true, ref, returnFocusRef);
  useDismissOnOutsidePointer(true, ref, onClose, ignoreRefs);

  // Runs after useReturnFocus has recorded the previous focus.
  useEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const items = enabledItems(menu);
    const target = initialFocus === 'last' ? items[items.length - 1] : items[0];
    (target ?? menu).focus();
    // Mount-only: later prop changes must not yank focus back.
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Contain every key: a portal still bubbles React events to its owner.
    e.stopPropagation();
    const menu = ref.current;
    if (!menu) return;
    const items = enabledItems(menu);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (n: number) => items[(n + items.length) % items.length]?.focus();

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusAt(i + 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        focusAt(i === -1 ? -1 : i - 1);
        return;
      case 'Home':
        e.preventDefault();
        focusAt(0);
        return;
      case 'End':
        e.preventDefault();
        focusAt(-1);
        return;
      case 'Escape':
      case 'Tab':
        e.preventDefault();
        onClose();
        return;
    }
    if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ch = e.key.toLowerCase();
      for (let k = 1; k <= items.length; k++) {
        const item = items[(i + k) % items.length];
        if ((item.textContent ?? '').trim().toLowerCase().startsWith(ch)) {
          item.focus();
          break;
        }
      }
    }
  };

  // Roving tabindex: whichever item has focus is the single tab stop.
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const menu = ref.current;
    if (!menu || !(e.target as HTMLElement).matches(ITEM_SELECTOR)) return;
    for (const el of menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) {
      el.tabIndex = el === e.target ? 0 : -1;
    }
  };

  const ctx = useRef<MenuContextValue>({ close: onClose });
  ctx.current.close = onClose;

  return createPortal(
    <MenuContext.Provider value={ctx.current}>
      <div
        ref={ref}
        id={id}
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        tabIndex={-1}
        style={style}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        onContextMenu={(e) => e.preventDefault()}
        className={`z-50 flex min-w-[200px] max-w-[calc(100vw-16px)] flex-col rounded-[10px] p-1.5 text-[13px] outline-none ${FLOATING_SURFACE} ${className}`}
      >
        {children}
      </div>
    </MenuContext.Provider>,
    document.body,
  );
}

type Tone = 'default' | 'buy' | 'sell';

const TONE: Record<Tone, string> = {
  default: 'text-text',
  buy: 'font-semibold text-buy',
  sell: 'font-semibold text-sell',
};

const ITEM_CLASS =
  'flex h-8 w-full flex-none items-center justify-between gap-3 rounded-md border-0 bg-transparent px-2.5 text-left font-[inherit] cursor-pointer ' +
  'hover:bg-[color:var(--chip,var(--surface-3))] focus:bg-[color:var(--chip,var(--surface-3))] focus:outline-none ' +
  'focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent ' +
  'aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent';

function useSelect(onSelect: () => void, disabled: boolean | undefined, keepOpen: boolean | undefined) {
  const ctx = useContext(MenuContext);
  return () => {
    if (disabled) return;
    // Closing and the action commit together. React runs the menu's cleanup
    // (focus back to the trigger) before a popover the action opens records
    // where its own focus should return, so that is the trigger too.
    if (!keepOpen) ctx?.close();
    onSelect();
  };
}

export interface MenuItemProps {
  onSelect: () => void;
  children: ReactNode;
  /** Secondary text on the right, for example a key hint. */
  hint?: ReactNode;
  tone?: Tone;
  disabled?: boolean;
  keepOpen?: boolean;
}

export function MenuItem({ onSelect, children, hint, tone = 'default', disabled, keepOpen }: MenuItemProps) {
  const select = useSelect(onSelect, disabled, keepOpen);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={select}
      className={`${ITEM_CLASS} ${TONE[tone]}`}
    >
      <span className="min-w-0 truncate">{children}</span>
      {hint !== undefined && <span className="flex-none text-[12px] font-normal text-muted">{hint}</span>}
    </button>
  );
}

export interface MenuItemRadioProps {
  checked: boolean;
  onSelect: () => void;
  children: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}

/** One choice among several (role=menuitemradio). Group them with MenuGroup. */
export function MenuItemRadio({ checked, onSelect, children, hint, disabled }: MenuItemRadioProps) {
  const select = useSelect(onSelect, disabled, false);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      onClick={select}
      className={`${ITEM_CLASS} ${checked ? 'font-semibold text-text-strong' : 'text-text'}`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={`h-1.5 w-1.5 flex-none rounded-full ${checked ? 'bg-accent' : 'bg-transparent'}`} />
        <span className="truncate">{children}</span>
      </span>
      {hint !== undefined && <span className="flex-none text-[11px] font-normal text-muted">{hint}</span>}
    </button>
  );
}

/** A labelled run of items, for example the radio set in a panel picker. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col">
      <div id={id} className="px-2.5 pb-2 pt-1.5 text-[11px] text-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-1 my-1.5 h-px flex-none bg-hairline" />;
}

/**
 * State and trigger wiring for a menu opened from a button.
 *
 *   const m = useMenuTrigger();
 *   <button {...m.triggerProps}>Actions</button>
 *   <Menu {...m.menuProps} label="Actions">...</Menu>
 *
 * Click toggles; ArrowDown opens at the first item, ArrowUp at the last.
 */
export function useMenuTrigger<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first');
  const triggerRef = useRef<T>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);

  const openAt = (where: 'first' | 'last') => {
    setInitialFocus(where);
    setOpen(true);
  };

  return {
    open,
    setOpen,
    triggerProps: {
      ref: triggerRef,
      'aria-haspopup': 'menu' as const,
      'aria-expanded': open,
      'aria-controls': open ? id : undefined,
      onClick: () => {
        setInitialFocus('first');
        setOpen((o) => !o);
      },
      onKeyDown: (e: KeyboardEvent<T>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          openAt(e.key === 'ArrowDown' ? 'first' : 'last');
        }
      },
    },
    menuProps: {
      id,
      open,
      onClose: close,
      anchor: triggerRef,
      initialFocus,
      returnFocusRef: triggerRef,
      ignoreRefs: [triggerRef],
    },
  };
}
